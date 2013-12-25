class Terminal < Hash
    def initialize(x, y) end
	def write xy, c
		print "\0337\033[#{xy[1]+1};#{xy[0]*2}f\033[#{(c==1? 44 : 49)}m  \033[44m\0338"
	end
    def beep() print "\a" end
    def get_current_key block = false 
        if block then STDIN.read_nonblock(1) rescue nil else STDIN.getc.to_i end
    end
end
class Window < Hash
    require 'rubygame'
    include Rubygame
    def initialize x, y, w = 800, h = 600
        @dxy = [w/x, h/y]
        @screen = Screen.new (@dxy).zip([x, y]).map{|i,j| i*j }
    end
    def write xy, c
        u = [0, 1].map { |a| xy.zip(@dxy).map{|i,j| (i + a)*j } }
        @screen.draw_box_s(u[0], u[1], [c * 0xff, c * 0xff, c * 0xff]).update
    end
    def beep() end
    attr_accessor :eq, :block, :on_unblock
    def unqueue a
        i = nil
        keys = [42, 34, 171, 187, 40, 41, 64, 43, 45, 47, 97, 98, 99, 100, 101, 102]
        (a.eq||=EventQueue.new).each {|e| i = keys.index e.key if e.is_a? KeyDownEvent}
        if a.block
            if i.nil?
                if ENV.size == 0
                    `setTimeout(function() { $opal.a.$unqueue($opal.a) }, 20)`
                else
                    sleep 0.02
                    unqueue a
                end
            else
                a.on_unblock.call(i) if not a.on_unblock.nil?
            end
        end
        i
    end
    def get_current_key block = false, on_unblock = nil
        @block = block
        @on_unblock = on_unblock
        if !block
            @ready = true
            return unqueue block
        else
            if ENV.size == 0
                `$opal.a = self`
                `setTimeout(function() { $opal.a.$unqueue($opal.a) }, 20)`
            else
                sleep 0.02
                unqueue self
            end
        end
    end
end
class Emulator
	def initialize str, ui
        @video = @in = @out = Object.const_get(ui).new(@width = 64, @height = 32)
		@mem = ("PJJJPCGCCHPBPIPPBPBPJJPBBPIPBPPIPJPPBCEEPJPJPPJPBPPJPJJOJOJOPIIIPOJJJOPIPIPPIPII").chars.map(&:ord).collect{|x|(x-65)*16}
        @mem = @mem.concat([0] * ((@pc = 0x200) - 80)).concat(str)
        @mem = @mem.concat([0] * 1000)#).chars.map(&:ord)
		@stack = @v = Array.new(16) { @I = @DT = @ST = 0 }
#		loop do
#            sleep 0.001
#		end
        @ready = true
        @pause = false
	end
    attr_accessor :ready, :pause
    def run_multiple b = self
        `$opal.b = b` if ENV.size == 0
        b.run if b.ready and not b.pause
        if ENV.size == 0
            b.pause = `document.getElementById('pause').checked`
            `setTimeout(function() {b.$run_multiple($opal.b)}, 20)`
        else
            sleep 0.02
            run_multiple b
        end
    end
    def run
        @ready = true
        @pc += 2 if run_instruction(@i = @mem[@pc+1] + @mem[@pc] * 256)
        if not defined?(@t) or Time.now - @t > (1.0/60)
            @t = Time.now
            @DT -= 1 if @DT > 0
            if (@ST -= 1) > 0
                @out.beep
            else
                @ST = 0
            end
        end
    end
	def key_pressed mode, char = @in.get_current_key
		test = (char.nil? or char.to_i != @v[f00])
        @pc += 2 if ((!mode && test) || (mode && !test))
	end
	def draw
		@v[0xf] = 0
        f = @i & 0xf
        f00 = (@i & 0xf00) >> (2 * 4)
        f0 = (@i & 0xf0) >> 4
		@mem[@I..(@I+f-1)].each_with_index do |line, dy|
			(0..7).each do |dx|
				xy = [(@v[f00] + dx) % @width, (@v[f0] + dy) % @height]
				(@video[xy] ||= [0]).push(((line >> (7 - dx)) & 1) ^ @video[xy][0])
				@out.write xy, @video[xy][1]
				@v[0xf] = 1 if @video[xy].delete_at(0) == 1 and @video[xy][0] == 0
			end
		end
	end
#	def method_missing n, *args, &block
#		if (s = n.to_s)[0] == "f" then (@i & s.to_i(16)) >> (s.scan("0").size * 4)
#		else super end
#	end
	def run_instruction i
        #printf "run pc=%d; i=%04x; v=[%s]; I=%d\n", ((@pc - 0x200) / 2), @i, @v.join(", "), @I
        f000 = (@i & 0xf000) >> (3 * 4)
        f00 = (@i & 0xf00) >> (2 * 4)
        f0 = (@i & 0xf0) >> ( 4)
        f = @i & 0xf
        ff = @i & 0xff
        fff = @i & 0xfff
        return if i == 0
		if i == 0xe0 then (0..@width-1).to_a.product((0..@height-1).to_a) { |xy| @out.write(xy, 0) }; @video = {} end
		if i == 0xee then @pc = @stack.pop end
		case f000
		when 8
			case f
			when 0 then @v[f00] = @v[f0]
			when 1,2,3 then @v[f00] = @v[f00].send ['|','&','^'][f-1], @v[f0]
			when 4 then a = (@v[f0]+@v[f00]);@v[15] = a != (@v[f00]=(a%256))? 1 : 0
			when 5 then @v[0xf] = @v[f00] > @v[f0] ? 1 : 0; @v[f00] = @v[f00] - @v[f0]; #puts "v#{f00} -= #{@v[f0]} => #{@v[f00]}"
			when 6 then @v[0xf] = (@v[f00] & 1)
			when 0xe then @v[0xf] = ((@v[f00] & 0xe000) >> 15)
			end
		when 1,2 then @stack.push(@pc) if(f000==2); @pc = fff; return false
		when 3,4,5,9 then @pc += 2 if @v[f00].send ([3,5].include?(f000)?'=':'!')+'=', [3,4].include?(f000)? ff : @v[f0]
		when 6,7 then if f000 == 6 then @v[f00]=ff else @v[f00] += ff end
		when 0xb then @pc = fff + @v[0]; return false
		when 0xc then @v[f00] = rand(0..255) & ff
		when 0xa then @I = fff
		when 0xd then draw
		when 0xe then key_pressed(ff == 0x9e) if [0xa1,0x9e].include? ff
		when 0xf
			case ff
			when 0x1e then @I += @v[f00]
			when 0x0a then @ready = false; @in.get_current_key(
                true,
                Proc.new { |e| @v[f00] = e; @ready = true })
			when 21,24 then instance_variable_set "@#{ff==24?'S':'D'}T", @v[f00]
			when 0x29 then @I = @v[f00] * 5
			when 0x07 then @v[f00] = @DT
			when 0x33 then sprintf("%03d",@v[f00]).split("").each_with_index { |v,x| @mem[@I+x] = v }
			when 0x55 then (0..f00).each { |x| @mem[x + @I] = @v[x] }
			when 0x65 then (0..f00).each { |x| @v[x] = @mem[x + @I].to_i }
			end
		end
		true
	end
end
#Emulator.new ARGV[0], ARGV[1] == nil ? "Window" : ARGV[1]