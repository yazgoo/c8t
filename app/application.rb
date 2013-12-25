require "opal"
require "assembler"
require "emulator"
assembly = Assembler.new.parse(`text = document.getElementById("editor").value`).output
e = Emulator.new(assembly, "Window");
e.run_multiple
