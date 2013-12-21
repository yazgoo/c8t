def instruction i
    top = (i & 0xf000) >> 12
    if i == 0xE0
        "CLS"
    elsif i == 0xEE
        "RET"
    elsif top == 0x8
        if (i & 0xf) == 0x0 
            "LD V#{(i & 0xf00) >> 8},V#{(i & 0xf0) >> 4}"
        else
            i.to_s(16)
        end
    elsif top == 0x0
        "SYS 0x#{(i & 0x0fff).to_s 16}"
    elsif top == 0x4
        "SNE V#{(i & 0x0f00) >> 8},0x#{(0xff & i).to_s 16}"
    elsif top == 0x6
        "LD V#{(i & 0x0f00) >> 8},0x#{(0xff & i).to_s 16}"
    elsif top == 0xD
        "DRW V#{(i & 0x0f00) >> 8},V#{(i & 0xf0) >> 4},#{i & 0xf}"
    elsif top == 0x7
        "ADD V#{(i & 0x0f00) >> 8},#{i & 0xff}"
    elsif top == 0x1
        "JP 0x#{(i & 0x0fff).to_s 16}"
    elsif top == 0x2
        "CALL 0x#{(i & 0x0fff).to_s 16}"
    elsif top == 0x3
        "SE V#{(i & 0x0f00) >> 8},#{i & 0xff}"
    elsif top == 0xA
        "LD I,0x#{(i & 0xfff).to_s 16}"
    elsif top == 0xf
        bottom = (i & 0xff)
        if bottom == 0x0a
            "LD V#{(i & 0x0f00) >> 8},Key"
        elsif bottom == 0x29
            "LD F,V#{(i & 0x0f00) >> 8}"
        elsif bottom == 0x1e
            "ADD I,V#{(i & 0x0f00) >> 8}"
        elsif bottom == 0x55
            "LD [I],V#{(i & 0x0f00) >> 8}"
        elsif bottom == 0x65
            "LD V#{(i & 0x0f00) >> 8},[I]"
        else
            i.to_s(16)
        end
    else
        i.to_s(16)
    end
end
def regs v
    s = ""
    (0..0xf).each do |i|
        s += "#{i.to_s(16)}:%4s " % v[i].to_s(16)
    end
    s
end
def start_debugging

    File.open(@out, "w") { |f| f.write "" } if not @out.nil?
end
def debug_instruction
    File.open(@out, "a") do |f|
        instr = instruction @i
        f.printf "%3s #{instr}#{" " * (15 - instr.size)}%4s\t#{regs @v}\n", @pc.to_s(16), @I.to_s(16)
    end if not @out.nil?
end
if __FILE__ == $0
    program = File.open ARGV[0] { |file| file.read }
    pos = 0x200
    j = 0
    (0..program.size/2-1).each do |x|
        i = program[2*x..2*x+1].unpack("n")[0]
        printf "%4x  %4x  ",pos, i
        puts instruction(i)
        pos += 2
    end
end
