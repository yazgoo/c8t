`xset b on`
`stty raw -echo`
memory = [0xF0, 0x90, 0x90, 0x90, 0xF0, 0x20, 0x60, 0x20, 0x20,
 0x70, 0xF0, 0x10, 0xF0, 0x80, 0xF0, 0xF0, 0x10, 0xF0, 0x10, 0xF0,
 0x90, 0x90, 0xF0, 0x10, 0x10, 0xF0, 0x80, 0xF0, 0x10, 0xF0, 0xF0,
 0x80, 0xF0, 0x90, 0xF0, 0xF0, 0x10, 0x20, 0x40, 0x40, 0xF0, 0x90,
 0xF0, 0x90, 0xF0, 0xF0, 0x90, 0xF0, 0x10, 0xF0, 0xF0, 0x90, 0xF0,
 0x90, 0x90, 0xE0, 0x90, 0xE0, 0x90, 0xE0, 0xF0, 0x80, 0x80, 0x80,
 0xF0, 0xE0, 0x90, 0x90, 0x90, 0xE0, 0xF0, 0x80, 0xF0, 0x80, 0xF0,
 0xF0, 0x80, 0xF0, 0x80, 0x80]
memory += ([0] * (0x200 - memory.size))
memory += File.open(ARGV[0], 'rb'){ |file| file.read }.bytes
memory += ([0] * (0xfff - memory.size))
def close
    `xset b off`
    `stty -raw echo`
    exit
end
def key_pressed v, i, pc, pressed_mode
    char = STDIN.read_nonblock(1) rescue nil
    test = (char.nil? or char.to_i != v[(i & 0x0f00) >> 8])
    test = !test if pressed_mode
    pc += 2 if test
    pc
end
def un i
    puts "unimplemented 0x#{i.to_s 16}"
    close
end
load "draw.rb"
load "dis.rb"
WIDTH = 64
HEIGHT = 32
screen = Screen.new WIDTH, HEIGHT
stack = []
video = {}
v = Array.new(16) { 0 }
pc = 0x200
j = 0
_I = 0
_DT = 0
_ST = 0
t = Time.now
OUT = ARGV[1]
File.open(OUT, "w") { |f| f.write "" } if not OUT.nil?
begin
while true do
    x = pc
    i = memory[x+1] + memory[x] * 256
    File.open(OUT, "a") do |f|
        instr = instruction i
        f.printf "%3s #{instr}#{" " * (15 - instr.size)}%4s\t#{regs v}\n", x.to_s(16), _I.to_s(16)
    end if not OUT.nil?
    top = (i & 0xf000) >> 12
    inc = true
    if i == 0xE0
        screen.clear
        video = {}
    elsif i == 0xEE
        pc = stack.pop
    elsif top == 0x8
        if (i & 0xf) == 0x0 
            v[(i & 0xf00) >> 8] = v[(i & 0xf0) >> 4]
        elsif (i & 0xf) == 0x01
            x = (i & 0xf00) >> 8 
            v[x] = (v[x] | v[(i & 0xf0) >> 4])
        elsif (i & 0xf) == 0x2
            x = (i & 0xf00) >> 8 
            v[x] = (v[(i & 0xf0) >> 4] & v[x])
        elsif (i & 0xf) == 0x4
            x = (i & 0xf00) >> 8 
            v[x] = (v[(i & 0xf0) >> 4] + v[x])
            v[0xf] = 0
            if v[x] > 255
                v[0xf] = 1
                v[x] = v[x] % 256
            end
        elsif (i & 0xf) == 0x5
            x = (i & 0xf00) >> 8 
            y = (i & 0xf0) >> 4
            v[0xf] = 0
            if v[x] > v[y]
                v[0xf] = 1
            end
            v[x] -= v[y]
        elsif (i & 0xf) == 0x3
            x = (i & 0xf00) >> 8 
            y = (i & 0xf0) >> 4
            v[x] = v[x] ^ v[y]
        elsif (i & 0xf) == 0x6
            v[0xf] = (v[(i & 0xf00) >> 8] & 0x1)
        elsif (i & 0xf) == 0xe
            v[0xf] = ((v[(i & 0xf00) >> 8] & 0xe000) >> 15)
        else
            un i
        end
    elsif top == 0x9
        pc += 2 if v[(i & 0x0f00) >> 8] != v[(i & 0xf0) >> 4]
    elsif top == 0x0
        "this instruction is ignored by modern interpreters"
        #pc = (i & 0x0fff)
        #inc = false
    elsif top == 0x2
        stack.push pc
        pc = (i & 0x0fff)
        inc = false
    elsif top == 0x4
        pc += 2 if v[(i & 0x0f00) >> 8] != (i & 0xff)
    elsif top == 0x6
        v[(i & 0x0f00) >> 8] = (i & 0xff)
    elsif top == 0xC
        v[(i & 0x0f00) >> 8] = (rand(0..255) & (i & 0xff))
    elsif top == 0xD
        _left = v[(i & 0x0f00) >> 8]
        _top = v[(i & 0xf0) >> 4]
        v[0xf] = 0
        (0..(i & 0xf)-1).each do |dy|
            address = dy + _I;
            line = memory[address]
            (0..7).each do |dx|
                x = (_left + dx) % WIDTH
                y = (_top + dy) % HEIGHT
                video[[x, y]] ||= 0
                nv = (((line >> (7 - dx)) & 0x1) ^ video[[x, y]])
                screen.write x, y, (nv == 1)
                v[0xf] = 1 if nv == 0 and video[[x, y]] == 1
                video[[x, y]] = nv
            end
        end
    elsif top == 0x7
        v[(i & 0x0f00) >> 8] += (i & 0xff)
    elsif top == 0x1
        pc = (i & 0x0fff)
        inc = false
    elsif top == 0x3
        pc += 2 if v[(i & 0x0f00) >> 8] == (i & 0xff)
    elsif top == 0x5
        pc += 2 if v[(i & 0x0f00) >> 8] == v[(i & 0xf0) >> 4]
    elsif top == 0xA
        _I = (i & 0xfff)
    elsif top == 0xb
        pc = (i & 0xfff) + v[0]
        inc = false
    elsif top == 0xe
        bottom = (i & 0xff)
        if bottom == 0xa1
           pc = key_pressed v, i, pc, false
        elsif bottom == 0x9e
           pc = key_pressed v, i, pc, true
        else
            un i
        end
    elsif top == 0xf
        bottom = (i & 0xff)
        if bottom == 0x1e
            _I += v[((i & 0x0f00) >> 8)]
        elsif bottom == 0x0a
            char = $stdin.getc
            v[(i & 0x0f00) >> 8] = char.to_i
        elsif bottom == 0x15
            _DT = v[(i & 0x0f00) >> 8]
        elsif bottom == 0x18
            _ST = v[(i & 0x0f00) >> 8]
        elsif bottom == 0x07
            v[(i & 0x0f00) >> 8] = _DT
        elsif bottom == 0x29
            _I = v[(i & 0x0f00) >> 8] * 5
        elsif bottom == 0x33
            digits = v[(i & 0x0f00) >> 8].to_s
            (0..2).each do |x|
                memory[_I + x] = digits[2 - x].to_i if digits.size > (2 - x)
            end
        elsif bottom == 0x55
            (0..((i & 0x0f00) >> 8)).each do |x|
                memory[x + _I] = v[x]
            end
        elsif bottom == 0x65
            (0..((i & 0x0f00) >> 8)).each do |x|
                v[x] = memory[x + _I]
            end
        else
            un i
        end
    else
        un i
    end
    pc += 2 if inc
    n_t = Time.now
    if n_t - t > (1.0/60)
        _DT -= 1 if _DT > 0
        if _ST > 0
            print "\a"
            _ST -= 1 
        end
        t = n_t
    end
    sleep(1.0/1000)
end
rescue Exception => e
    close
    throw e
end
