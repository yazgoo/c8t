load 'app/emulator.rb'
load 'app/assembler.rb'
str = `xxd -p "#{ARGV[0]}"`
str = str.split("\n").join
p str[1044]
text = Assembler.new.unparse str
p text.split("\n")[1040/2]
p text.split("\n")[1042/2]
p text.split("\n")[1044/2]
p text.split("\n")[1046/2]
output = Assembler.new.parse(text).output
p output[1044]
e = Emulator.new output, ARGV[1] == nil ? "Window" : ARGV[1]
e.run_multiple
#loop do
#    sleep 0.001
#    e.run
#end
