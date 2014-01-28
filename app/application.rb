require "opal"
require "opal-jquery"
require "assembler"
require "emulator"
module Kernel
    def clear what
        `clearInterval(#{what})`
    end
    def every interval, &block
        callback = `function(){ #{block.call}; }`
        `setInterval(callback, #{interval})`
    end
end
class Runner
    def run text
        assembly = Assembler.new.parse(text).output
        e = Emulator.new(assembly, "Window");
        e.run_multiple
        e
    end
    def keys_push k
        @@keys << k
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
        @special = ['%', ' ', ',', '/', '?', '=', '\n', ':', '{', '}', '"']
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
        JSON.parse decode(pa)
    end
    def minify_program
        address = `location.href`
        address = address.split("?")[0] if parameter
        address += "?p=" + encode({
            :title => Element['#title'].value, 
            :author => Element['#author'].value, 
            :date => Element['#date'].value, 
            :content => Element['#editor'].value}.to_json)
        minify address
    end
    def load_program
        Element['#editor'].value = parameter[:content] if parameter
    end
    def setup
        @@keys = []
        %x{ window.key = #{@@keys}}
        load_program
        key_to_keypad_key = {37=> 4, 39=> 6, 38=> 2, 40=> 8, 32=> 5}
        Element['body'].on(:keydown) do |e|
            keys_push << key_to_keypad_key[e.key_code]
        end
        Element['#screen'].on(:mousedown) do |e|
            left = `e.$target().offset().left`
            x = (e.page_x - left) / e.target.width
            @click = every 100 do
                k = x > 2.0/3 ? 6 : x > 1.0/3 ? 5 : 4
                keys_push k
            end
        end
        Element['#screen'].on(:mouseup) do |e|
            clear @click
        end
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
    @@page = 1
    def list page=1
        Element['#choose'].append("<option>----dyn---</option>") if page == 1
        opts =  { 
            :payload => "format=json&q=" + encode("select * from json where url=\"https://bitly.com/u/c8tc8t.json?page=#{page}\""),
        }
        HTTP.new("http://query.yahooapis.com/v1/public/yql?callback=parse_response", "POST", opts).send!
    end
    def parse_response response
        if `response.query.results.json.data != undefined`
            data = `JSON.stringify(response.query.results.json.data)`
            JSON.parse(data).each do |l|
                option_s = l["url"].split("?p=")[1]
                option = JSON.parse(option_s)
                Element['#choose'].append("<option value='#{option_s}'>#{option['title']}</option>")
            end
            @@page += 1
            list @@page
        end
    end
end
