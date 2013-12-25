require "opal"
require "assembler"
require "emulator"
#assembly = Assembler.new.parse(`text = document.getElementById("editor").value`).output
class Runner
    def run text
        assembly = Assembler.new.parse(text).output
        p assembly
        e = Emulator.new(assembly, "Window");
        e.run_multiple
        e
    end
    def run2 text
        assembly = text.split("\n").join.scan(/../).map{ |s| s.to_i(16) }
        p assembly
        e = Emulator.new(assembly, "Window");
        e.run_multiple
        e
    end
end
