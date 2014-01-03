load 'app/emulator.rb'
load 'app/assembler.rb'
str = `xxd -p "#{ARGV[0]}"`
str = str.split("\n").join
text = Assembler.new.unparse str
output = Assembler.new.parse(text).output
e = Emulator.new output, ARGV[1] == nil ? "Window" : ARGV[1]
e.run_multiple
