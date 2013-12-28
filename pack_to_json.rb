require 'json'
res = {}
ARGV.each do |dir|
    Dir[dir+ "/*.ch8"].each do |f|
        full, title, author, date, add= File.basename(f).sub("(alt)", "-alt").sub("(", "[").sub(")", "]").match(/(([^\[]*)(?:\[([^,]*)(?:, (.*))?\])?(.*)).ch8/).to_a[1..-1]
        txt = f.sub(".ch8", ".txt")
        title = (title + add).strip
        short = title
        short = short[0..15] if short.size > 15
        res[full] = { :short => short, :title => title, :author => author, :date => date,
              :description => File.exists?(txt)?File.open(txt){|f|f.read}:nil,
              :content => `xxd -p "#{f}"` 
        }
    end
end
puts("pack=" + res.to_json)
