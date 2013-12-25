;CLS
LD v0, 0
LD v1, 0
LD v5, 0
loop:
    LD v2, k
    SE v5, 0
    DRW v0, v1, 5
    CALL multiply
    DRW v0, v1, 5
    ;ADD v0, 8
    ADD v5, 1
    JP loop
multiply:
    LD I, 0
    SE v2, 0
    call add_5
    RET
add_5:
    LD v3, 5
    LD v4, 1
    ADD I, v3
    SUB v2, v4
    SE v2, 0
    JP add_5
    RET
