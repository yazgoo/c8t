sprite :cross do
"
1   1
 1 1
  1
 1 1
1   1"
end
sprite :square do
"
11111
1   1
1   1
1   1
11111"
end
sprite :filled_square do
"
11111
11111
11111
11111
11111"
end
end
draw :square, 0, 10
_loop do
    set :x { rand(32) }
    set :y { rand(64) }
    draw :cross, :x, :y
    when :collision { set :current_sprite { } }
end
