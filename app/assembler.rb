class Assembler
    def initialize
        @labels = {}
        @address = 0x200
        @result = []
        @binary = []
        @text = []
        @instructions = {
            /CLS/ => "00E0",
            /RET/ => "00EE",
            #/SYS (\w+)/ => "0%03x",
            /JP (\w+)/ => "1%03x",
            /CALL (\w+)/ => "2%03x",
            /SE V(\d+), (\d+)/ => "3%1x%02x",
            /SNE V(\d+), (\d+)/ => "4%1x%02x",
            /SE V(\d+), V(\d+)/ => "5%1x%1x0",
            /LD V(\d+), (\d+)/ => "6%1x%02x",
            /ADD V(\d+), (\d+)/ => "7%1x%02x",
            /LD V(\d+), V(\d+)/ => "8%1x%1x0",
            /OR V(\d+), V(\d+)/ => "8%1x%1x1",
            /AND V(\d+), V(\d+)/ => "8%1x%1x2",
            /XOR V(\d+), V(\d+)/ => "8%1x%1x3",
            /ADD V(\d+), V(\d+)/ => "8%1x%1x4",
            /SUB V(\d+), V(\d+)/ => "8%1x%1x5",
            /SHR V(\d+)/ => "8%1x06",
            /SUBN V(\d+), V(\d+)/ => "8%1x%1x7",
            /SHL V(\d+)/ => "8%1x0E",
            /SNE V(\d+), V(\d+)/ => "9%1x%1x0",
            /LD I, (\w+)/ => "A%03x",
            /JP V0, (\w+)/ => "B%03x",
            /RND V(\d+), (\d+)/ => "C%1x%02x",
            /DRW V(\d+), V(\d+), (\d+)/ => "D%1x%1x%1x",
            /SKP V(\d+)/ => "E%1x9E",
            /SKNP V(\d+)/ => "E%1xA1",
            /LD V(\d+), DT/ => "F%1x07",
            /LD V(\d+), K/ => "F%1x0A",
            /LD DT, V(\d+)/ => "F%1x15",
            /LD ST, V(\d+)/ => "F%1x18",
            /ADD I, V(\d+)/ => "F%1x1E",
            /LD F, V(\d+)/ => "F%1x29",
            /LD B, V(\d+)/ => "F%1x33",
            /LD -I-, V(\d+)/ => "F%1x55",
            /LD V(\d+), -I-/ => "F%1x65",
        }
#        @reverse_instructions = Hash[@reverse_instructions.to_a.collect do |k, v|
#            [ "lol" + k.gsub("%1x", ".").gsub("%02x", "..")
#              .gsub("%03x", "..."), v ]
#        end]
        @reverse_instructions = Hash[@instructions.to_a.collect(&:reverse)].collect do |k, v|
            [ k.gsub("%1x", "(.)").gsub("%02x", "(..)")
              .gsub("%03x", "(...)"), v ]
        end
        @reverse_instructions = Hash[@reverse_instructions]
    end
    def parse data
        if data.is_a? Array
            data.each { |line| parse_line line }
        else
            data = data.gsub "\\n", "\n"
            if data.include? "\n"
                data.split("\n").each { |line| parse_line line }
#            else
#                File.open(source) do |f|
#                    f.each_line { |line| parse_line line.chomp }
#                end
            end
        end
        self
    end
    def unparse data
        if data.is_a? Array
            data.each { |i| parse_instruction i }
        else
            data = data.gsub("\\n", "").gsub "\\r", ""
            data.scan(/..../) { |i| parse_instruction i }
        end
        @text.join("\n")
    end
    def parse_instruction_simple i
        i = i.upcase
        @reverse_instructions.keys.each do |re|
            if !!(m = i.match(Regexp.new(re)))
                ins = @reverse_instructions[re].to_s
                ins = ins[7..-2]if ins.start_with? "("
                return sprintf(ins.to_s.gsub('(\\d+)', '%d').gsub('(\\w+)', '%d'), *(m.to_a[1..-1].map{|x| x.to_i(16)}))
            end
        end
        sprintf(".data %d", i.to_i(16))
    end
    def parse_instruction i
        @text << parse_instruction_simple(i)
    end
    def output where = nil
        assemble
#        assemble
#        if where.nil?
#            @binary
#        else
#            File.open(destination, 'wb') do |output|
#                output.write @binary
#            end
#        end
        @binary
    end
    def assemble
        @result.each do |instruction, parameters|
            parameters.collect! do |p|
                !!(p =~ /^[-+]?[0-9]+$/)?p.to_i : @labels[p]
            end
            str = sprintf instruction, *parameters
            @binary << str[0..1].to_i(16) << str[2..3].to_i(16)
        end
    end
    def parse_line line
        line = line.split(" ")
        if line.size > 0
            return if line[0][0] == ";"
            if line[0][-1..-1] == ":"
                @labels[line[0].split(":")[0].upcase] = @address
                parse_line line[1..-1] if line[1..-1].size > 0
                return
            end
            line = line.collect!{|i| i.upcase }.join " "
            r = @instructions.keys.map{ |re| (line.match(re) and re.to_s.split.size == line.split.size)?re : nil }.compact.first
            if r.nil?
                @result << ["%04x", [line.split.last.to_i.to_s]]
            else
                @result << [@instructions[r], line.match(r).to_a[1..-1]]
            end
            @address += 2
        end
    end
end
#p Assembler.new.parse(ARGV[0]).output(ARGV[1])
