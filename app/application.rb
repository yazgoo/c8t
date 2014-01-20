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
        opts =  { 
            :format => "json",
            :payload => "apiKey=R_f857b8e18d6f401f917086b316e9f3de&login=c8tc8t&longUrl=" + address,
        }
        HTTP.new("http://api.bitly.com/v3/shorten?callback=?", "POST", opts).callback do |response|
            url = `response.body.data.url`
            `alert("url: " + url)`
        end.errback do |a, b, c|
            p a, b, c
            puts "errback 0"
            puts "errback 4"
        end.send!
    end
end
