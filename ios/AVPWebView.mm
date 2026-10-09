#import "AVPWebView.h"

#import <WebKit/WebKit.h>

#import <react/renderer/components/RNAllVideoPlayerSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNAllVideoPlayerSpec/EventEmitters.h>
#import <react/renderer/components/RNAllVideoPlayerSpec/Props.h>
#import <react/renderer/components/RNAllVideoPlayerSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

static NSString *const kBridgeName = @"AVPBridge";

// Keeps WKUserContentController from retaining the view.
@interface AVPScriptHandler : NSObject <WKScriptMessageHandler>
@property (nonatomic, weak) id<WKScriptMessageHandler> target;
@end

@implementation AVPScriptHandler
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message
{
  [self.target userContentController:controller didReceiveScriptMessage:message];
}
@end

@interface AVPWebView () <RCTAVPWebViewViewProtocol, WKNavigationDelegate, WKScriptMessageHandler>
@end

@implementation AVPWebView {
  WKWebView *_webView;
  NSString *_html;
  NSString *_baseUrl;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<AVPWebViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const AVPWebViewProps>();
    _props = defaultProps;
    [self createWebView];
  }
  return self;
}

- (void)createWebView
{
  WKWebViewConfiguration *config = [WKWebViewConfiguration new];
  config.allowsInlineMediaPlayback = YES;
  config.allowsPictureInPictureMediaPlayback = NO;
  config.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;

  AVPScriptHandler *handler = [AVPScriptHandler new];
  handler.target = self;
  [config.userContentController addScriptMessageHandler:handler name:kBridgeName];
  NSString *bridge = [NSString stringWithFormat:
      @"window.%@ = { postMessage: function (data) { window.webkit.messageHandlers.%@.postMessage(String(data)); } };",
      kBridgeName, kBridgeName];
  [config.userContentController
      addUserScript:[[WKUserScript alloc] initWithSource:bridge
                                           injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                        forMainFrameOnly:YES]];

  _webView = [[WKWebView alloc] initWithFrame:self.bounds configuration:config];
  _webView.navigationDelegate = self;
  _webView.opaque = NO;
  _webView.backgroundColor = UIColor.blackColor;
  _webView.scrollView.backgroundColor = UIColor.blackColor;
  _webView.scrollView.scrollEnabled = NO;
  _webView.scrollView.bounces = NO;
  _webView.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
  self.contentView = _webView;
}

- (void)destroyWebView
{
  [_webView stopLoading];
  [_webView.configuration.userContentController removeScriptMessageHandlerForName:kBridgeName];
  _webView.navigationDelegate = nil;
  [_webView removeFromSuperview];
  _webView = nil;
  _html = nil;
  _baseUrl = nil;
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  [self destroyWebView];
  [self createWebView];
}

- (void)dealloc
{
  [self destroyWebView];
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &newProps = *std::static_pointer_cast<const AVPWebViewProps>(props);
  NSString *html = [NSString stringWithUTF8String:newProps.html.c_str()] ?: @"";
  NSString *baseUrl = [NSString stringWithUTF8String:newProps.baseUrl.c_str()] ?: @"";

  if (html.length > 0 && (![html isEqualToString:_html] || ![baseUrl isEqualToString:_baseUrl])) {
    _html = html;
    _baseUrl = baseUrl;
    [_webView loadHTMLString:html baseURL:[NSURL URLWithString:baseUrl]];
  }

  [super updateProps:props oldProps:oldProps];
}

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  RCTAVPWebViewHandleCommand(self, commandName, args);
}

- (void)injectJavaScript:(NSString *)script
{
  [_webView evaluateJavaScript:script completionHandler:nil];
}

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message
{
  if (!_eventEmitter) return;
  NSString *data = [message.body isKindOfClass:NSString.class] ? message.body : @"";
  std::static_pointer_cast<const AVPWebViewEventEmitter>(_eventEmitter)
      ->onMessage(AVPWebViewEventEmitter::OnMessage{.data = std::string(data.UTF8String ?: "")});
}

// The page itself never navigates; YouTube's iframe (a sub-frame) loads freely.
- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)action
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler
{
  WKFrameInfo *target = action.targetFrame;
  if (target != nil && !target.isMainFrame) {
    decisionHandler(WKNavigationActionPolicyAllow);
    return;
  }
  NSString *url = action.request.URL.absoluteString ?: @"";
  BOOL allowed = [url isEqualToString:@"about:blank"] || (_baseUrl.length > 0 && [url hasPrefix:_baseUrl]);
  decisionHandler(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error
{
  [self emitLoadError:error];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error
{
  [self emitLoadError:error];
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView
{
  if (_html.length > 0) [webView loadHTMLString:_html baseURL:[NSURL URLWithString:_baseUrl]];
}

- (void)emitLoadError:(NSError *)error
{
  if (!_eventEmitter || error.code == NSURLErrorCancelled) return;
  std::static_pointer_cast<const AVPWebViewEventEmitter>(_eventEmitter)
      ->onLoadError(AVPWebViewEventEmitter::OnLoadError{
          .description = std::string(error.localizedDescription.UTF8String ?: "")});
}

@end
