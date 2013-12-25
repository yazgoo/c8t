load 'app/emulator.rb'
str = File.open(ARGV[0]) { |f| f.read }
e = Emulator.new str.bytes, ARGV[1] == nil ? "Window" : ARGV[1]
e.run_multiple
#loop do
#    sleep 0.001
#    e.run
#end
