#import "AVPOrientation.h"

#import <React/RCTUtils.h>
#import <objc/runtime.h>

/*
 Rotating needs the app delegate's application:supportedInterfaceOrientationsForWindow:
 to allow it. That method is wrapped once on first use: while fullscreen it answers
 landscape, otherwise it defers to the app's own implementation (or Info.plist).
 */

typedef UIInterfaceOrientationMask (*AVPOrientationsIMP)(id, SEL, UIApplication *, UIWindow *);

static UIInterfaceOrientationMask gOverride = 0;
static AVPOrientationsIMP gOriginal = NULL;
static BOOL gInstalled = NO;

static UIInterfaceOrientationMask AVPInfoPlistMask(void)
{
  NSDictionary *info = NSBundle.mainBundle.infoDictionary;
  NSArray *names = nil;
  if (UIDevice.currentDevice.userInterfaceIdiom == UIUserInterfaceIdiomPad) {
    names = info[@"UISupportedInterfaceOrientations~ipad"];
  }
  if (names == nil) names = info[@"UISupportedInterfaceOrientations"];

  UIInterfaceOrientationMask mask = 0;
  for (NSString *name in names) {
    if ([name isEqualToString:@"UIInterfaceOrientationPortrait"]) mask |= UIInterfaceOrientationMaskPortrait;
    else if ([name isEqualToString:@"UIInterfaceOrientationPortraitUpsideDown"]) mask |= UIInterfaceOrientationMaskPortraitUpsideDown;
    else if ([name isEqualToString:@"UIInterfaceOrientationLandscapeLeft"]) mask |= UIInterfaceOrientationMaskLandscapeLeft;
    else if ([name isEqualToString:@"UIInterfaceOrientationLandscapeRight"]) mask |= UIInterfaceOrientationMaskLandscapeRight;
  }
  return mask ?: UIInterfaceOrientationMaskAllButUpsideDown;
}

static UIInterfaceOrientationMask AVPSupportedOrientations(id self, SEL _cmd, UIApplication *app, UIWindow *window)
{
  if (gOverride) return gOverride;
  if (gOriginal) return gOriginal(self, _cmd, app, window);
  return AVPInfoPlistMask();
}

static UIInterfaceOrientationMask AVPAppMask(UIWindow *window)
{
  UIApplication *app = UIApplication.sharedApplication;
  id<UIApplicationDelegate> delegate = app.delegate;
  if ([delegate respondsToSelector:@selector(application:supportedInterfaceOrientationsForWindow:)]) {
    return [delegate application:app supportedInterfaceOrientationsForWindow:window];
  }
  return gOverride ?: AVPInfoPlistMask();
}

static void AVPInstallHook(void)
{
  if (gInstalled) return;
  UIApplication *app = UIApplication.sharedApplication;
  id<UIApplicationDelegate> delegate = app.delegate;
  if (delegate == nil) return;
  gInstalled = YES;

  Class cls = [delegate class];
  SEL sel = @selector(application:supportedInterfaceOrientationsForWindow:);
  Method existing = class_getInstanceMethod(cls, sel);
  IMP inherited = existing ? method_getImplementation(existing) : NULL;

  if (class_addMethod(cls, sel, (IMP)AVPSupportedOrientations, "Q@:@@")) {
    gOriginal = (AVPOrientationsIMP)inherited;
    if (!existing) {
      // UIKit caches which optional delegate methods exist when the delegate is set.
      app.delegate = nil;
      app.delegate = delegate;
    }
  } else {
    gOriginal = (AVPOrientationsIMP)method_setImplementation(existing, (IMP)AVPSupportedOrientations);
  }
}

static UIViewController *AVPTopViewController(UIViewController *controller)
{
  while (controller.presentedViewController) controller = controller.presentedViewController;
  return controller;
}

static void AVPApplyOrientation(UIInterfaceOrientation preferred)
{
  if (@available(iOS 16.0, *)) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (![scene isKindOfClass:UIWindowScene.class]) continue;
      UIWindowScene *windowScene = (UIWindowScene *)scene;
      for (UIWindow *window in windowScene.windows) {
        [window.rootViewController setNeedsUpdateOfSupportedInterfaceOrientations];
        [AVPTopViewController(window.rootViewController) setNeedsUpdateOfSupportedInterfaceOrientations];
      }
      UIInterfaceOrientationMask mask = AVPAppMask(windowScene.windows.firstObject);
      UIWindowSceneGeometryPreferencesIOS *prefs =
          [[UIWindowSceneGeometryPreferencesIOS alloc] initWithInterfaceOrientations:mask];
      [windowScene requestGeometryUpdateWithPreferences:prefs errorHandler:nil];
    }
  } else {
    [UIDevice.currentDevice setValue:@(preferred) forKey:@"orientation"];
    [UIViewController attemptRotationToDeviceOrientation];
  }
}

@implementation AVPOrientation

RCT_EXPORT_MODULE(AVPOrientation)

- (void)lockLandscape
{
  RCTExecuteOnMainQueue(^{
    AVPInstallHook();
    gOverride = UIInterfaceOrientationMaskLandscape;
    AVPApplyOrientation(UIInterfaceOrientationLandscapeRight);
  });
}

- (void)restore
{
  RCTExecuteOnMainQueue(^{
    if (!gOverride) return;
    gOverride = 0;
    AVPApplyOrientation(UIInterfaceOrientationPortrait);
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeAVPOrientationSpecJSI>(params);
}

@end
