module Rubygame
    class KeyDownEvent
        attr_accessor :key
        def initialize key
            @key = key
        end
    end
    class Screen
        def initialize size
            @ctx = `document.getElementById('screen').getContext('2d')`
            `
            this.ctx.fillStyle='#000000';
            this.ctx.fillRect(0,0,#{size[0]},#{size[1]});
            `
        end
        def draw_box_s p1, p2, c
            color = "rgb(#{c[0]}, #{c[1]}, #{c[2]})"
            `
            this.ctx.fillStyle=color;
            this.ctx.fillRect(#{p1[0].to_i},#{p1[1].to_i},#{p2[0].to_i - p1[0].to_i},#{p2[1].to_i - p1[1].to_i});
            `
            self
        end
        def update
        end
    end
    class EventQueue
        def each
            `if (window.key != undefined) {//blah`
            t = [42, 34, 171, 187, 40, 41, 64, 43, 45, 47, 97, 98, 99, 100, 101, 102]
            i = t[`window.key`]
            yield KeyDownEvent.new i
            `window.key = undefined}`
        end
    end
end
