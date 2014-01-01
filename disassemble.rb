load "app/assembler.rb"
xxd_p = "\
a21ec2013201a21ad0147004304012006000710431201200121880402010\
20408010"
text = Assembler.new.unparse xxd_p
p text
output = Assembler.new.parse(text).output.map { |x| 
    sprintf "%02x", x }.join
p xxd_p, output
puts xxd_p == output
