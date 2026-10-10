require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-all-video-player"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"] || "https://www.npmjs.com/package/react-native-all-video-player"
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/dharmveerofficial/react-native-all-video-player.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm}"
  s.private_header_files = "ios/**/*.h"
  s.frameworks   = "WebKit", "AVFoundation", "AVKit"

  install_modules_dependencies(s)
end
