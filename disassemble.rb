load "app/assembler.rb"
xxd_p = "\
6108225861122258fe0a610922608700611322608800898089744902129c\
4903129c490c129c4907128c490b128c8a906040f015f00730001234227c\
fe0a6109226087006113226088008980897499a0128c4907129c1230a2f0\
6208d12700ee660162096001f029d125f618c307430000ee7001d1253007\
1266126462096109f729d1256113f829d12500eea2ac60006115d015a2b1\
6008d015129aa2b660006110d015a2bb6008d01512aa8b8989a9dbb2322a\
26a68e8a8a8aeeee88ec28ee"
text = Assembler.new.unparse xxd_p
output = Assembler.new.parse(text).output.map { |x| 
    sprintf "%02x", x }.join
puts xxd_p == output
