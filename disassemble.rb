load "app/assembler.rb"
require 'json'
File.open("pack.js") do |f|
JSON.load(f.read[5..-1]).each do |k, item|
    p item
    xxd_p = item["content"].split("\n").join
    text = Assembler.new.unparse xxd_p
    p text
    output = Assembler.new.parse(text).output.map { |x| 
        sprintf "%02x", x }.join
        if xxd_p != output
        puts xxd_p
        puts output
        puts xxd_p == output
        ks = []
        (xxd_p.size > output.size ? xxd_p.size : output.size).times do |i|
            if xxd_p[i] == output[i]
                printf "."
            else
                printf "%s", (output[i].nil? ? xxd_p[i] : output[i] )
                ks << (i / 4) if (i < output.size or output[i] == "0")
            end
        end
        puts
        p ks, output.size, xxd_p.size
        p ks.map {|k| text.split("\n")[k]} 
        exit if ks.size != 0 and (xxd_p.size - output.size > 3)
        end
end
end
puts "ok"
