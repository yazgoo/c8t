require "opal"
require "opal-jquery"
require "assembler"
require "emulator"
class Runner
    def run text
        assembly = Assembler.new.parse(text).output
        e = Emulator.new(assembly, "Window");
        e.run_multiple
        e
    end
    def disassemble text
        Assembler.new.unparse text
    end
    def assemble text
        Assembler.new.parse(text).output.map{ |x| sprintf "%02x", x }.join
    end
    def run2 text
        assembly = text.split("\n").join.scan(/../).map{ |s| s.to_i(16) }
        e = Emulator.new(assembly, "Window");
        e.run_multiple
        e
    end
    def minify address
        #`jQuery.support.cors = true`
        opts = {
#            :crossDomain => true,
#            :headers => {
#                :Location => true,
#            },
#            "Access-Control-Request-Headers" => "Location",
            :payload => 'url=http://github.com/&code=json'}
        HTTP.new("http://git.io", "POST", opts).callback do |a, b, c|
            puts "callback"
        end.errback do |a, b, c|
            puts "errback 0"
            puts "errback 4"
        end.send!
    end
end
