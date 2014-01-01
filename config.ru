require 'bundler'
Bundler.require
run Opal::Server.new do |s|
    s.append_path 'app'
    s.main = 'application'
end
