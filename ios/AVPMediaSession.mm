#import "AVPMediaSession.h"

#import <AVFoundation/AVFoundation.h>
#import <MediaPlayer/MediaPlayer.h>
#import <React/RCTCallableJSModules.h>

/*
 The system media session: headphone / AirPods / Bluetooth buttons, the lock screen and Control
 Center control the player that's playing. Commands go to JS as 'AVPMediaCommand' events.
 Unplugging headphones (or a Bluetooth headset going away) pauses, as other players do.
 */

static NSString *const kEvent = @"AVPMediaCommand";

@implementation AVPMediaSession {
  NSMutableArray *_targets;
  BOOL _observingRoute;
}

@synthesize callableJSModules = _callableJSModules;

RCT_EXPORT_MODULE(AVPMediaSession)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)emit:(NSString *)command position:(NSNumber *)position
{
  NSMutableDictionary *event = [@{ @"command" : command } mutableCopy];
  if (position != nil) event[@"position"] = position;
  [_callableJSModules invokeModule:@"RCTDeviceEventEmitter" method:@"emit" withArgs:@[ kEvent, event ]];
}

- (void)addTarget:(MPRemoteCommand *)command named:(NSString *)name
{
  __weak AVPMediaSession *weakSelf = self;
  id target = [command addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
    [weakSelf emit:name position:nil];
    return MPRemoteCommandHandlerStatusSuccess;
  }];
  [_targets addObject:@[ command, target ]];
}

- (void)registerCommands
{
  if (_targets != nil) return;
  _targets = [NSMutableArray new];
  MPRemoteCommandCenter *center = MPRemoteCommandCenter.sharedCommandCenter;
  [self addTarget:center.playCommand named:@"play"];
  [self addTarget:center.pauseCommand named:@"pause"];
  [self addTarget:center.togglePlayPauseCommand named:@"toggle"];
  [self addTarget:center.nextTrackCommand named:@"next"];
  [self addTarget:center.previousTrackCommand named:@"previous"];
  __weak AVPMediaSession *weakSelf = self;
  id seek = [center.changePlaybackPositionCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
    [weakSelf emit:@"seek" position:@(((MPChangePlaybackPositionCommandEvent *)event).positionTime)];
    return MPRemoteCommandHandlerStatusSuccess;
  }];
  [_targets addObject:@[ center.changePlaybackPositionCommand, seek ]];
  if (!_observingRoute) {
    _observingRoute = YES;
    [NSNotificationCenter.defaultCenter addObserver:self
                                           selector:@selector(routeChanged:)
                                               name:AVAudioSessionRouteChangeNotification
                                             object:nil];
  }
}

- (void)routeChanged:(NSNotification *)notification
{
  NSNumber *reason = notification.userInfo[AVAudioSessionRouteChangeReasonKey];
  if (reason.unsignedIntegerValue != AVAudioSessionRouteChangeReasonOldDeviceUnavailable) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self emit:@"pause" position:nil];
  });
}

- (void)update:(BOOL)playing
      position:(double)position
      duration:(double)duration
   hasPrevious:(BOOL)hasPrevious
       hasNext:(BOOL)hasNext
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (playing) {
      // Remote commands go to the app playing audio in the playback category.
      AVAudioSession *audio = AVAudioSession.sharedInstance;
      if (audio.category != AVAudioSessionCategoryPlayback) {
        [audio setCategory:AVAudioSessionCategoryPlayback error:nil];
      }
      [audio setActive:YES error:nil];
    }
    [self registerCommands];
    MPRemoteCommandCenter *center = MPRemoteCommandCenter.sharedCommandCenter;
    center.nextTrackCommand.enabled = hasNext;
    center.previousTrackCommand.enabled = hasPrevious;
    MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = @{
      MPMediaItemPropertyPlaybackDuration : @(duration),
      MPNowPlayingInfoPropertyElapsedPlaybackTime : @(position),
      MPNowPlayingInfoPropertyPlaybackRate : @(playing ? 1.0 : 0.0),
    };
  });
}

- (void)releaseSession
{
  for (NSArray *pair in _targets) {
    [(MPRemoteCommand *)pair[0] removeTarget:pair[1]];
  }
  _targets = nil;
  MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nil;
}

- (void)release
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [self releaseSession];
  });
}

- (void)invalidate
{
  [NSNotificationCenter.defaultCenter removeObserver:self];
  [self release];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeAVPMediaSessionSpecJSI>(params);
}

@end
