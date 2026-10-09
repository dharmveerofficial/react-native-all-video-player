#import "AVPVideoView.h"

#import <AVFoundation/AVFoundation.h>
#import <CommonCrypto/CommonDigest.h>

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

/** True for a near-uniform frame (black, or one flat colour). */
static BOOL AVPIsFlat(CGImageRef image)
{
  const size_t width = 32, height = 18;
  uint8_t pixels[width * height * 4];
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(pixels, width, height, 8, width * 4, space,
                                               kCGImageAlphaNoneSkipLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (context == NULL) return NO;
  CGContextDrawImage(context, CGRectMake(0, 0, width, height), image);
  CGContextRelease(context);
  double sum = 0, sumSq = 0;
  for (size_t i = 0; i < width * height; i++) {
    double luma = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
    sum += luma;
    sumSq += luma * luma;
  }
  double mean = sum / (width * height);
  return sumSq / (width * height) - mean * mean < 40;
}
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
  BOOL _grabPoster;
  NSString *_posterFor;
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
  _grabPoster = newProps.grabPoster;
  [self maybeGrabPoster];
  [super updateProps:props oldProps:oldProps];
}

// Once per source, off the main thread; streams (HLS/DASH) just don't get one.
- (void)maybeGrabPoster
{
  NSString *source = _source;
  if (!_grabPoster || source.length == 0 || [source isEqualToString:_posterFor]) return;
  NSURL *url = [NSURL URLWithString:source];
  if (url == nil) return;
  _posterFor = source;

  NSURL *file = [AVPVideoView posterFileForSource:source];
  __weak AVPVideoView *weakSelf = self;
  void (^deliver)(void) = ^{
    dispatch_async(dispatch_get_main_queue(), ^{
      [weakSelf emitPoster:file forSource:source];
    });
  };
  if ([NSFileManager.defaultManager fileExistsAtPath:file.path]) {
    deliver();
    return;
  }

  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
  [asset loadValuesAsynchronouslyForKeys:@[ @"duration" ]
                       completionHandler:^{
                         double seconds = CMTimeGetSeconds(asset.duration);
                         if (!isfinite(seconds) || seconds <= 0) return;
                         [AVPVideoView grabFrameFromAsset:asset seconds:seconds toFile:file then:deliver];
                       }];
}

// Intros are often a blank slide or a fade from black: takes the first of these
// frames that isn't flat, else the first one that loaded.
+ (void)grabFrameFromAsset:(AVAsset *)asset seconds:(double)seconds toFile:(NSURL *)file then:(void (^)(void))deliver
{
  AVAssetImageGenerator *generator = [AVAssetImageGenerator assetImageGeneratorWithAsset:asset];
  generator.appliesPreferredTrackTransform = YES;
  generator.maximumSize = CGSizeMake(1280, 1280);
  generator.requestedTimeToleranceBefore = kCMTimePositiveInfinity;
  generator.requestedTimeToleranceAfter = kCMTimePositiveInfinity;
  NSMutableArray *times = [NSMutableArray array];
  for (NSNumber *fraction in @[ @0.1, @0.25, @0.5 ]) {
    [times addObject:[NSValue valueWithCMTime:CMTimeMakeWithSeconds(seconds * fraction.doubleValue, 600)]];
  }
  __block NSUInteger remaining = times.count;
  __block BOOL done = NO;
  __block UIImage *fallback = nil;
  [generator generateCGImagesAsynchronouslyForTimes:times
                                  completionHandler:^(CMTime requested, CGImageRef image, CMTime actual,
                                                      AVAssetImageGeneratorResult result, NSError *error) {
                                    (void)generator; // keep the generator alive until it finishes
                                    remaining--;
                                    if (done) return;
                                    UIImage *picked = nil;
                                    if (result == AVAssetImageGeneratorSucceeded && image != NULL) {
                                      UIImage *frame = [UIImage imageWithCGImage:image];
                                      if (!AVPIsFlat(image)) picked = frame;
                                      else if (fallback == nil) fallback = frame;
                                    }
                                    if (picked == nil && remaining == 0) picked = fallback;
                                    if (picked == nil) return;
                                    done = YES;
                                    [generator cancelAllCGImageGeneration];
                                    NSData *jpeg = UIImageJPEGRepresentation(picked, 0.85);
                                    if (jpeg && [jpeg writeToURL:file atomically:YES]) deliver();
                                  }];
}

/** A cache file per source URL. */
+ (NSURL *)posterFileForSource:(NSString *)source
{
  NSURL *dir = [[NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject
      URLByAppendingPathComponent:@"avp-posters"
                      isDirectory:YES];
  [NSFileManager.defaultManager createDirectoryAtURL:dir withIntermediateDirectories:YES attributes:nil error:nil];
  NSData *bytes = [[@"v2:" stringByAppendingString:source] dataUsingEncoding:NSUTF8StringEncoding];
  unsigned char digest[CC_SHA1_DIGEST_LENGTH];
  CC_SHA1(bytes.bytes, (CC_LONG)bytes.length, digest);
  NSMutableString *name = [NSMutableString stringWithCapacity:CC_SHA1_DIGEST_LENGTH * 2 + 4];
  for (int i = 0; i < CC_SHA1_DIGEST_LENGTH; i++) [name appendFormat:@"%02x", digest[i]];
  [name appendString:@".jpg"];
  return [dir URLByAppendingPathComponent:name];
}

- (void)emitPoster:(NSURL *)file forSource:(NSString *)source
{
  if (!_eventEmitter || ![source isEqualToString:_source]) return;
  std::static_pointer_cast<const AVPVideoViewEventEmitter>(_eventEmitter)
      ->onVideoPoster(AVPVideoViewEventEmitter::OnVideoPoster{.uri = std::string(file.absoluteString.UTF8String ?: "")});
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
  _posterFor = nil;
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  [self releasePlayer];
  _source = nil;
  _grabPoster = NO;
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
