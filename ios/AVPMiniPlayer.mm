#import "AVPMiniPlayer.h"

#import <React/RCTFabricSurface.h>
#import <React/RCTSurfaceHostingView.h>
#import <React/RCTSurfacePresenter.h>
#import <React/RCTCallableJSModules.h>
#import <React/RCTUtils.h>

/*
 The in-app mini player: runs the 'AVPMiniPlayer' React component as a second Fabric surface of
 the app's own React instance (found through the root view's surface presenter), laid over the
 key window at the frame JS asks for. Dragging and pinch-to-resize are handled here.
 */

static NSString *const kComponent = @"AVPMiniPlayer";
static const CGFloat kMargin = 12;
static const CGFloat kTopExtra = 40;
static const CGFloat kBottomOffset = 80;
static const CGFloat kMinWidth = 160;
static const CGFloat kCornerRadius = 10;
static const NSTimeInterval kAnimation = 0.26;

// The transform that draws a view framed at `frame` over `target` instead.
static CGAffineTransform AVPTransformOnto(CGRect frame, CGRect target)
{
  if (frame.size.width <= 0 || frame.size.height <= 0) return CGAffineTransformIdentity;
  return CGAffineTransformMake(target.size.width / frame.size.width, 0, 0, target.size.height / frame.size.height,
                               CGRectGetMidX(target) - CGRectGetMidX(frame), CGRectGetMidY(target) - CGRectGetMidY(frame));
}

@implementation AVPMiniPlayer {
  RCTSurfaceHostingView *_view;
  NSArray<UIGestureRecognizer *> *_gestures;
  CGPoint _dragStart;
  CGRect _pinchStart;
  CGRect _miniFrame;
  BOOL _expanded;
}

@synthesize callableJSModules = _callableJSModules;

RCT_EXPORT_MODULE(AVPMiniPlayer)

// Dragging is handled here, in window coordinates: the view moves under the finger, so JS
// touch positions (relative to it) can't track it. Taps still reach the React content.
- (void)handlePan:(UIPanGestureRecognizer *)pan
{
  UIView *view = pan.view;
  UIView *window = view.superview;
  if (window == nil) return;
  if (pan.state == UIGestureRecognizerStateBegan) {
    [view.layer removeAllAnimations];
    _dragStart = view.frame.origin;
  }
  CGPoint delta = [pan translationInView:window];
  CGRect frame = view.frame;
  frame.origin = CGPointMake(_dragStart.x + delta.x, _dragStart.y + delta.y);
  view.frame = frame;
  if (pan.state != UIGestureRecognizerStateEnded && pan.state != UIGestureRecognizerStateCancelled) return;

  CGFloat width = window.bounds.size.width;
  if (frame.origin.x < -frame.size.width * 0.4 || frame.origin.x > width - frame.size.width * 0.6) {
    [self removeView];
    [_callableJSModules invokeModule:@"RCTDeviceEventEmitter" method:@"emit" withArgs:@[ @"AVPMiniPlayerClosed" ]];
    return;
  }
  [self settle:view];
}

// Pinch resizes around the centre, keeping the aspect ratio.
- (void)handlePinch:(UIPinchGestureRecognizer *)pinch
{
  UIView *view = pinch.view;
  UIView *window = view.superview;
  if (window == nil) return;
  if (pinch.state == UIGestureRecognizerStateBegan) {
    [view.layer removeAllAnimations];
    _pinchStart = view.frame;
  }
  CGFloat ratio = _pinchStart.size.height / MAX(1, _pinchStart.size.width);
  CGFloat maxWidth = MAX(kMinWidth, window.bounds.size.width - kMargin * 2);
  CGFloat width = MIN(MAX(_pinchStart.size.width * pinch.scale, kMinWidth), maxWidth);
  CGFloat height = width * ratio;
  view.frame = CGRectMake(CGRectGetMidX(_pinchStart) - width / 2, CGRectGetMidY(_pinchStart) - height / 2, width, height);
  if (pinch.state == UIGestureRecognizerStateEnded || pinch.state == UIGestureRecognizerStateCancelled) {
    [self settle:view];
  }
}

// Snaps to the nearer side, inside the window.
- (void)settle:(UIView *)view
{
  UIView *window = view.superview;
  CGRect frame = view.frame;
  CGFloat width = window.bounds.size.width;
  CGFloat toX = frame.origin.x + frame.size.width / 2 < width / 2 ? kMargin : width - frame.size.width - kMargin;
  CGFloat minY = kMargin + kTopExtra;
  CGFloat maxY = MAX(minY, window.bounds.size.height - kBottomOffset - frame.size.height);
  CGFloat toY = MIN(MAX(frame.origin.y, minY), maxY);
  [UIView animateWithDuration:0.22
                   animations:^{
                     view.frame = CGRectMake(toX, toY, frame.size.width, frame.size.height);
                   }];
}

// Sets the frame at once and animates out of `from` (drawn scaled, so the React content
// doesn't re-lay out every frame).
- (void)setFrame:(CGRect)frame of:(UIView *)view animatingFrom:(CGRect)from
{
  [view.layer removeAllAnimations];
  view.transform = CGAffineTransformIdentity;
  view.frame = frame;
  if (from.size.width <= 0 || from.size.height <= 0) return;
  view.transform = AVPTransformOnto(frame, from);
  [UIView animateWithDuration:kAnimation
                   animations:^{
                     view.transform = CGAffineTransformIdentity;
                   }];
}

- (void)removeView
{
  RCTSurfaceHostingView *view = _view;
  _view = nil;
  _gestures = nil;
  _expanded = NO;
  [(RCTFabricSurface *)view.surface stop];
  [view removeFromSuperview];
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

// The presenter of the app's main surface, from the root view in the key window.
- (RCTSurfacePresenter *)surfacePresenter
{
  UIView *root = RCTKeyWindow().rootViewController.view;
  if (![root isKindOfClass:[RCTSurfaceHostingView class]]) return nil;
  id<RCTSurfaceProtocol> surface = ((RCTSurfaceHostingView *)root).surface;
  if (![(NSObject *)surface isKindOfClass:[RCTFabricSurface class]]) return nil;
  @try {
    id presenter = [(NSObject *)surface valueForKey:@"surfacePresenter"];
    return [presenter isKindOfClass:[RCTSurfacePresenter class]] ? presenter : nil;
  } @catch (NSException *exception) {
    return nil;
  }
}

- (NSNumber *)isSupported
{
  __block BOOL supported = NO;
  RCTUnsafeExecuteOnMainQueueSync(^{
    supported = [self surfacePresenter] != nil;
  });
  return @(supported);
}

- (NSNumber *)show:(double)x
                 y:(double)y
             width:(double)width
            height:(double)height
             fromX:(double)fromX
             fromY:(double)fromY
         fromWidth:(double)fromWidth
        fromHeight:(double)fromHeight
{
  __block BOOL shown = NO;
  RCTUnsafeExecuteOnMainQueueSync(^{
    if (self->_view == nil) {
      RCTSurfacePresenter *presenter = [self surfacePresenter];
      UIWindow *window = RCTKeyWindow();
      if (presenter == nil || window == nil) return;
      RCTFabricSurface *surface = [[RCTFabricSurface alloc] initWithSurfacePresenter:presenter
                                                                         moduleName:kComponent
                                                                  initialProperties:@{}];
      RCTSurfaceHostingView *view = [[RCTSurfaceHostingView alloc] initWithSurface:surface
                                                                   sizeMeasureMode:RCTSurfaceSizeMeasureModeWidthExact |
                                                                                   RCTSurfaceSizeMeasureModeHeightExact];
      view.layer.cornerRadius = kCornerRadius;
      view.clipsToBounds = YES;
      UIPanGestureRecognizer *pan = [[UIPanGestureRecognizer alloc] initWithTarget:self action:@selector(handlePan:)];
      pan.maximumNumberOfTouches = 1;
      UIPinchGestureRecognizer *pinch = [[UIPinchGestureRecognizer alloc] initWithTarget:self
                                                                                  action:@selector(handlePinch:)];
      [view addGestureRecognizer:pan];
      [view addGestureRecognizer:pinch];
      [window addSubview:view];
      [surface start];
      self->_view = view;
      self->_gestures = @[ pan, pinch ];
    }
    self->_expanded = NO;
    self->_view.layer.cornerRadius = kCornerRadius;
    for (UIGestureRecognizer *gesture in self->_gestures) gesture.enabled = YES;
    [self setFrame:CGRectMake(x, y, width, height)
                    of:self->_view
         animatingFrom:CGRectMake(fromX, fromY, fromWidth, fromHeight)];
    shown = YES;
  });
  return @(shown);
}

- (void)move:(double)x y:(double)y width:(double)width height:(double)height
{
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_view.frame = CGRectMake(x, y, width, height);
  });
}

- (void)hide
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [self removeView];
  });
}

- (void)hideTo:(double)x y:(double)y width:(double)width height:(double)height
{
  dispatch_async(dispatch_get_main_queue(), ^{
    RCTSurfaceHostingView *view = self->_view;
    if (view == nil) return;
    [view.layer removeAllAnimations];
    CGAffineTransform onto = AVPTransformOnto(view.frame, CGRectMake(x, y, width, height));
    [UIView animateWithDuration:kAnimation
        animations:^{
          view.transform = onto;
        }
        completion:^(BOOL finished) {
          if (self->_view == view) [self removeView];
        }];
  });
}

- (void)expand
{
  dispatch_async(dispatch_get_main_queue(), ^{
    UIView *view = self->_view;
    if (view == nil || self->_expanded || view.superview == nil) return;
    [view.layer removeAllAnimations];
    self->_expanded = YES;
    self->_miniFrame = view.frame;
    for (UIGestureRecognizer *gesture in self->_gestures) gesture.enabled = NO;
    view.layer.cornerRadius = 0;
    [self setFrame:view.superview.bounds of:view animatingFrom:self->_miniFrame];
  });
}

- (void)collapse
{
  dispatch_async(dispatch_get_main_queue(), ^{
    UIView *view = self->_view;
    if (view == nil || !self->_expanded) return;
    self->_expanded = NO;
    for (UIGestureRecognizer *gesture in self->_gestures) gesture.enabled = YES;
    view.layer.cornerRadius = kCornerRadius;
    [self setFrame:self->_miniFrame of:view animatingFrom:view.superview.bounds];
  });
}

- (NSNumber *)topInset
{
  __block CGFloat top = 0;
  RCTUnsafeExecuteOnMainQueueSync(^{
    top = RCTKeyWindow().safeAreaInsets.top;
  });
  return @(top);
}

- (void)invalidate
{
  [self hide];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeAVPMiniPlayerSpecJSI>(params);
}

@end
