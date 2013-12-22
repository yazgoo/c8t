class Assembler
    def initialize source, destination
        @labels = {}
        @address = 0x200
        @result = []
        @binary = ""
        @instructions = {
            /CLS/ => "00E0",
            /RET/ => "00EE",
            /SYS (\w+)/ => "0%3x",
            /JP (\w+)/ => "1%3x",
            /CALL (\w+)/ => "2%3x",
            /SE V(\d+), (\d+)/ => "3%1x%2x",
            /SNE V(\d+), (\d+)/ => "4%1x%2x",
            /SE V(\d+), V(\d+)/ => "5%1x%1x0",
            /LD V(\d+), (\d+)/ => "6%1x%2x",
            /ADD V(\d+), (\d+)/ => "7%1x%2x",
            /LD V(\d+), V(\d+)/ => "8%1x%1x0",
            /OR V(\d+), V(\d+)/ => "8%1x%1x1",
            /AND V(\d+), V(\d+)/ => "8%1x%1x2",
            /XOR V(\d+), V(\d+)/ => "8%1x%1x3",
            /ADD V(\d+), V(\d+)/ => "8%1x%1x4",
            /SUB V(\d+), V(\d+)/ => "8%1x%1x5",
            /SHR V(\d+) {, V(\d+)}/ => "8%1x%1x6",
            /SUBN V(\d+), V(\d+)/ => "8%1x%1x7",
            /SHL V(\d+) {, V(\d+)}/ => "8%1x%1xE",
            /SNE V(\d+), V(\d+)/ => "9%1x%1x0",
            /LD I, (\w+)/ => "A%3x",
            /JP V0, (\w+)/ => "B%3x",
            /RND V(\d+), (\d+)/ => "C%1x%2x",
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
            /LD [I], V(\d+)/ => "F%1x55",
            /LD V(\d+), [I]/ => "F%1x65",
        }
        File.open(source) do |f|
            f.each_line { |line| parse_line line.chomp.split }
        end
        assemble
        File.open(destination, 'wb') do |output|
              output.write @binary
        end
    end
    def assemble
        @result.each do |instruction, parameters|
            parameters.collect! do |p|
                !!(p =~ /^[-+]?[0-9]+$/)?p.to_i: @labels[p]
            end
            str = sprintf instruction, *parameters
            p instruction, parameters
            @binary += [str].pack('H*')
        end
    end
    def parse_line line
        if line.size > 0
            return if line[0][0] == ";"
            if line[0][-1..-1] == ":"
                @labels[line[0].split(":")[0].upcase] = @address
                parse_line line[1..-1]
                return
            end
            line = line.collect!{|i| i.upcase }.join " "
            r = @instructions.keys.map{ |re| line.match(re)?re : nil }.compact.first
            @result << [@instructions[r], line.match(r).to_a[1..-1]]
            @address += 2
        end
    end
end
Assembler.new *ARGV
