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
    def after interval, &block
        callback = `function(){ #{block.call}; }`
        `setTimeout(callback, #{interval})`
    end
end
class Runner
    attr_accessor :emulator
    def run text
        assembly = Assembler.new.parse(text).output
        @emulator = Emulator.new(assembly, "Window");
        @emulator.run_multiple
        @emulator
    end
    def keys_push k
        @@keys << [k, Time.new]
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
        fill_keyboard
        setup
        list
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
            key = key_to_keypad_key[e.key_code]
            keys_push key
            key.nil?
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
            e.target.focus()
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
        %x{
 window.parse_response = function(r)
 { window.runner.$parse_response(r); }
        }
        opts =  { 
            :payload => "format=json&q=" + encode("select * from json where url=\"https://bitly.com/u/c8tc8t.json?page=#{page}\""),
        }
        HTTP.new("http://query.yahooapis.com/v1/public/yql?callback=window.parse_response", "POST", opts).send!
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
    def writeHelp
        Element["#description"].html(<<-eos
This is a chip8 emulator.<br/>
On the right, you have an editor with the current program.<br/>
You can either erase it or (dis)assemble it.<br/>
The assembly is in hexadecimal.<br/>
You can start playing the current program with the play button.<br/>
Once started, the default program prints the current key pressed.
<br/>
Keys, from 0 to f, are available on the left.<br/>
You can pause, reload, fullscreen the current program.<br/>
Finaly you can load ROMs via the upper left drop down menu.<br/>
The editor allows you to modify/write your own program.<br/>
Once your modification is done, just press the reload button.<br/>
You can pause the program, enable logging and playing it
step by step.<br/>
Some usefull links:
<ul><li><a href=http://www.chip8.com>chip8.com</a></li>
<li><a href=http://devernay.free.fr/hacks/chip8/C8TECH10.HTM>
a really good description</a></li></ul>
eos
)
    end
    def goFullScreen
        %x{ 
        elem = document.getElementById("screen");
        if (elem.requestFullscreen) {
          elem.requestFullscreen();
          } else if (elem.msRequestFullscreen) {
              elem.msRequestFullscreen();
        } else if (elem.mozRequestFullScreen) {
              elem.mozRequestFullScreen();
        } else if (elem.webkitRequestFullscreen) {
              elem.webkitRequestFullscreen();
        }
        }
        return
    end
    def fill_keyboard
        k = [1,2,3,0xc,4,5,6,0xd,7,8,9,0xe,0xa,0,0xb,0xf]
        html = ""
        4.times do |i|
            4.times do |j|
                s = k[(4 * i + j)].to_s(16)
                html += "<input id='key' class='key key_#{s}'\
                type='button' value='#{s}'\ 
                onclick='window.runner.$keys_push(0x#{s})'/>"
            end
            html += "<br/>"
        end
        Element["#keyboard"].html html
    end
    def hide_show g
        e = Element[g]
        e.toggle
        screen_width = e.parent.css('width').to_f
        show = e.css('display') != 'none'
        f = Element['#screen_container']
        _p = f.css('width').to_f
        _p /= screen_width
        size = (_p + (show ? -1 : 1) * 0.2) * screen_width
        f.width(size)
        Element['#control'].width(size)
    end
    def check_uncheck a, on, off
        prefix = 'control_button fa fa-2x fa-';
        e = @emulator
        %x{
        if(a.getAttribute('class').indexOf(on) == -1) {
            a.setAttribute('class', prefix + on);
        }
        else {
            if(e == null) launch_hexa_or_source();
                a.setAttribute('class', prefix + off);
        }}
        return
    end
    def play_pause
        Element["#big_play_button"].css :visibility => :hidden
        check_uncheck `document.getElementById("pause")`, "play", "pause"
    end
    def launch3 select
        @emulator.pause if not @emulator.nil?
        game = JSON.parse select
        ['title', 'author', 'date'].each do |i|
            Element["##{i}"].value = game[i]
        end
        text = game['content'] 
        Element["#editor"].value = text
        description = game['description']
        description = "" if description.nil?
        description = description.gsub '\n', "<br/>"
        Element["#description"].html = <<-eos
        <b>#{game['title']}</b>, by #{game['author']}
        in #{game['date']}<hr/>#{description}
eos
        run2 text
    end
    def launch_hexa_or_source
        @emulator.pause if not @emulator.nil?
        code = Element['#editor'].value
        if code.include? " "
            run code
        else
            run2 code
        end
    end
end
