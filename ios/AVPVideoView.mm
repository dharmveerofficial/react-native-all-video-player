#import "AVPVideoView.h"

#import <AVFoundation/AVFoundation.h>

#import <react/renderer/components/RNAllVideoPlayerSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNAllVideoPlayerSpec/EventEmitters.h>
#import <react/renderer/components/RNAllVideoPlayerSpec/Props.h>
#import <react/renderer/components/RNAllVideoPlayerSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

// Same codes as YouTube's player states, which the JS side uses for both engines.
typedef NS_ENUM(NSInteger, AVPState) {
  AVPStateUnstarted = -1,
  AVPStateEnded = 0,
  AVPStatePlaying = 1,
  AVPStatePaused = 2,
  AVPStateBuffering = 3,
  AVPStateCued = 5,
};

static void *kItemStatusContext = &kItemStatusContext;
static void *kTimeControlContext = &kTimeControlContext;

@interface AVPPlayerLayerView : UIView
@end

@implementation AVPPlayerLayerView
+ (Class)layerClass
{
  return AVPlayerLayer.class;
}
@end

@interface AVPVideoView () <RCTAVPVideoViewViewProtocol>
@end

@implementation AVPVideoView {
  AVPPlayerLayerView *_layerView;
  AVPlayer *_player;
  NSString *_source;
  id _timeObserver;
  BOOL _ready;
  BOOL _ended;
  BOOL _hasPlayed;
  float _rate;
  AVPState _lastState;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<AVPVideoViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const AVPVideoViewProps>();
    _props = defaultProps;
    _rate = 1;
    _lastState = AVPStateUnstarted;
    _layerView = [[AVPPlayerLayerView alloc] initWithFrame:self.bounds];
    _layerView.backgroundColor = UIColor.blackColor;
    ((AVPlayerLayer *)_layerView.layer).videoGravity = AVLayerVideoGravityResizeAspect;
    self.backgroundColor = UIColor.blackColor;
    self.contentView = _layerView;
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &newProps = *std::static_pointer_cast<const AVPVideoViewProps>(props);
  NSString *source = [NSString stringWithUTF8String:newProps.source.c_str()] ?: @"";
  if (![source isEqualToString:_source]) {
    _source = source;
    [self loadSource:source];
  }
  [super updateProps:props oldProps:oldProps];
}

- (void)loadSource:(NSString *)source
{
  [self releasePlayer];
  NSURL *url = [NSURL URLWithString:source];
  if (url == nil) return;

  AVPlayerItem *item = [AVPlayerItem playerItemWithURL:url];
  _player = [AVPlayer playerWithPlayerItem:item];
  _player.actionAtItemEnd = AVPlayerActionAtItemEndPause;
  ((AVPlayerLayer *)_layerView.layer).player = _player;

  [item addObserver:self forKeyPath:@"status" options:NSKeyValueObservingOptionNew context:kItemStatusContext];
  [_player addObserver:self forKeyPath:@"timeControlStatus" options:NSKeyValueObservingOptionNew context:kTimeControlContext];
  [NSNotificationCenter.defaultCenter addObserver:self
                                         selector:@selector(itemDidEnd:)
                                             name:AVPlayerItemDidPlayToEndTimeNotification
                                           object:item];
  [NSNotificationCenter.defaultCenter addObserver:self
                                         selector:@selector(itemFailed:)
                                             name:AVPlayerItemFailedToPlayToEndTimeNotification
                                           object:item];

  __weak AVPVideoView *weakSelf = self;
  _timeObserver = [_player addPeriodicTimeObserverForInterval:CMTimeMakeWithSeconds(0.5, NSEC_PER_SEC)
                                                        queue:dispatch_get_main_queue()
                                                   usingBlock:^(CMTime time) {
                                                     [weakSelf emitProgress];
                                                   }];
}

- (void)releasePlayer
{
  if (_player == nil) return;
  [_player pause];
  if (_timeObserver) [_player removeTimeObserver:_timeObserver];
  _timeObserver = nil;
  [_player.currentItem removeObserver:self forKeyPath:@"status" context:kItemStatusContext];
  [_player removeObserver:self forKeyPath:@"timeControlStatus" context:kTimeControlContext];
  [NSNotificationCenter.defaultCenter removeObserver:self name:nil object:_player.currentItem];
  ((AVPlayerLayer *)_layerView.layer).player = nil;
  _player = nil;
  _ready = NO;
  _ended = NO;
  _hasPlayed = NO;
  _lastState = AVPStateUnstarted;
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  [self releasePlayer];
  _source = nil;
  _rate = 1;
}

- (void)dealloc
{
  [self releasePlayer];
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary *)change
                       context:(void *)context
{
  if (context == kItemStatusContext) {
    AVPlayerItem *item = _player.currentItem;
    if (item.status == AVPlayerItemStatusReadyToPlay && !_ready) {
      _ready = YES;
      [self emitReady];
      [self updateState];
    } else if (item.status == AVPlayerItemStatusFailed) {
      [self emitError:item.error];
    }
  } else if (context == kTimeControlContext) {
    [self updateState];
  } else {
    [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
  }
}

- (void)itemDidEnd:(NSNotification *)notification
{
  _ended = YES;
  [self updateState];
}

- (void)itemFailed:(NSNotification *)notification
{
  [self emitError:notification.userInfo[AVPlayerItemFailedToPlayToEndTimeErrorKey]];
}

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  RCTAVPVideoViewHandleCommand(self, commandName, args);
}

- (void)play
{
  if (_player == nil) return;
  if (_ended) {
    _ended = NO;
    [_player seekToTime:kCMTimeZero];
  }
  // Plays through the silent switch, like other video apps.
  [AVAudioSession.sharedInstance setCategory:AVAudioSessionCategoryPlayback error:nil];
  [_player playImmediatelyAtRate:_rate];
}

- (void)pause
{
  [_player pause];
}

- (void)seekTo:(double)seconds
{
  if (_player == nil) return;
  _ended = NO;
  [_player seekToTime:CMTimeMakeWithSeconds(MAX(0, seconds), NSEC_PER_SEC)
      toleranceBefore:kCMTimeZero
       toleranceAfter:kCMTimeZero];
  [self updateState];
}

- (void)setRate:(float)rate
{
  if (rate <= 0) return;
  _rate = rate;
  if (_player.timeControlStatus != AVPlayerTimeControlStatusPaused) _player.rate = rate;
}

- (void)setMuted:(BOOL)muted
{
  _player.muted = muted;
}

- (void)updateState
{
  if (_player == nil || !_ready) return;
  AVPState state;
  if (_ended) {
    state = AVPStateEnded;
  } else if (_player.timeControlStatus == AVPlayerTimeControlStatusPlaying) {
    state = AVPStatePlaying;
    _hasPlayed = YES;
  } else if (_player.timeControlStatus == AVPlayerTimeControlStatusWaitingToPlayAtSpecifiedRate) {
    state = AVPStateBuffering;
  } else {
    state = _hasPlayed ? AVPStatePaused : AVPStateCued;
  }
  if (state == _lastState || !_eventEmitter) return;
  _lastState = state;
  std::static_pointer_cast<const AVPVideoViewEventEmitter>(_eventEmitter)
      ->onVideoState(AVPVideoViewEventEmitter::OnVideoState{.state = (int)state});
}

- (double)durationSeconds
{
  CMTime duration = _player.currentItem.duration;
  if (!CMTIME_IS_NUMERIC(duration)) return 0;
  double seconds = CMTimeGetSeconds(duration);
  return isfinite(seconds) && seconds > 0 ? seconds : 0;
}

- (void)emitReady
{
  if (!_eventEmitter) return;
  std::static_pointer_cast<const AVPVideoViewEventEmitter>(_eventEmitter)
      ->onVideoReady(AVPVideoViewEventEmitter::OnVideoReady{.duration = [self durationSeconds]});
}

- (void)emitProgress
{
  if (!_eventEmitter || !_ready) return;
  double current = CMTimeGetSeconds(_player.currentTime);
  std::static_pointer_cast<const AVPVideoViewEventEmitter>(_eventEmitter)
      ->onVideoProgress(AVPVideoViewEventEmitter::OnVideoProgress{
          .currentTime = isfinite(current) ? current : 0, .duration = [self durationSeconds]});
}

- (void)emitError:(NSError *)error
{
  if (!_eventEmitter) return;
  NSString *message = error.localizedDescription ?: @"The video could not be played";
  std::static_pointer_cast<const AVPVideoViewEventEmitter>(_eventEmitter)
      ->onVideoError(AVPVideoViewEventEmitter::OnVideoError{.message = std::string(message.UTF8String ?: "")});
}

@end
