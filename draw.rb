class Screen
    def initialize width, height
        @width = width
        @height = height
    end
    def clear
        (0..@width-1).each do |x|
            (0..@height-1).each do |y|
                write x, y, false
            end
        end
    end
    def write x, y, what
        print "\0337"
        print "\033[#{y + 1};#{x*2}f"
        print "\033[#{(what ? 44:49)}m  \033[44m"
        print "\0338"
    end
end
