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
        Assembler.new.parse(text).output.map{ |x| sprintf "%02X", x }.join
    end
    def run2 text
        assembly = text.split("\n").join.scan(/../).map{ |s| s.to_i(16) }
        e = Emulator.new(assembly, "Window");
        e.run_multiple
        e
    end
    def initialize
        @special = ['%', ' ', ',', '/', '?', '=', '\n', ':']
    end
    def encode address
        @special.each do |s|
            address = address.gsub s, (sprintf "%%%02X", s.ord)
        end
        address
    end
    def decode address
        @special.reverse.each do |s|
            address = address.gsub (sprintf "%%%02X", s.ord), s
        end
        address
    end
    def parameter
        pa = `location.search.split('p=')[1]`
        return false if `pa == undefined`
        decode(pa)
    end
    def minify_program
        address = `location.href`
        address = address.split("?")[0] if parameter
        address += "?p=" + encode(Element['#editor'].value)
        minify address
    end
    def load_program
        Element['#editor'].value = parameter if parameter
    end
    def minify address
        opts =  { 
            :format => "json",
            :payload => "apiKey=R_f857b8e18d6f401f917086b316e9f3de&login=c8tc8t&longUrl=" + 
            encode(address),
        }
        HTTP.new("http://api.bitly.com/v3/shorten?callback=?", "POST", opts).callback do |response|
            url = `response.body.data.url`
            `alert("url: " + url)`
        end.errback do |a, b, c|
            p a, b, c
        end.send!
    end
end
