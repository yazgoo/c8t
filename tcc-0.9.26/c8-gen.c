#ifdef TARGET_DEFS_ONLY
#define REG_VALUE(reg) (((reg) & 0x7))
#define NB_REGS       16
#define RC_INT     0x0001
#define RC_FLOAT   0x0002
#define RC_EAX     0x0004
#define RC_ST0     0x0008
#define RC_ECX     0x0010
#define RC_EDX     0x0020
#define RC_INT_BSIDE  0x00000040
#define RC_C8_V0     0
#define RC_C8_V1     1
#define RC_C8_V1     1
#define RC_C8_V2     2
#define RC_C8_V3     3
#define RC_C8_V4     4
#define RC_C8_V5     5
#define RC_C8_V6     6
#define RC_C8_V7     7
#define RC_C8_V8     8
#define RC_C8_V9     9
#define RC_C8_Va     0xa
#define RC_C8_Vb     0xb
#define RC_C8_Vc     0xc
#define RC_C8_Vd     0xd
#define RC_C8_Ve     0xe
#define RC_C8_Vf     0xf
#define RC_IRET RC_C8_V4
#define RC_LRET RC_C8_V5
#define RC_FRET RC_C8_V4
enum {
    TREG_C8_V0,
    TREG_C8_V1,
    TREG_C8_V2,
    TREG_C8_V3,
    TREG_C8_V4,
    TREG_C8_V5,
    TREG_C8_V6,
    TREG_C8_V7,
    TREG_C8_V8,
    TREG_C8_V9,
    TREG_C8_Va,
    TREG_C8_Vb,
    TREG_C8_Vc,
    TREG_C8_Vd,
    TREG_C8_Ve,
    TREG_C8_Vf
};
#define REG_FRET RC_C8_V4
#define REG_IRET TREG_C8_V5
#define REG_LRET TREG_C8_V4
#define PTR_SIZE 2
#define LDOUBLE_SIZE 8
#define LDOUBLE_ALIGN 2
#define MAX_ALIGN 2
#define EM_TCC_TARGET EM_C60
#define R_DATA_32 R_C60_32
#define R_DATA_PTR R_C60_32
#define R_JMP_SLOT  R_C60_JMP_SLOT
#define R_COPY      R_C60_COPY
#define ELF_START_ADDR 0x00000400
#define ELF_PAGE_SIZE  0x1000
#else /* ! TARGET_DEFS_ONLY */
#include "tcc.h"
ST_DATA const int reg_classes[NB_REGS] = {
    RC_C8_V0,
    RC_C8_V1,
    RC_C8_V1,
    RC_C8_V2,
    RC_C8_V3,
    RC_C8_V4,
    RC_C8_V5,
    RC_C8_V6,
    RC_C8_V7,
    RC_C8_V8,
    RC_C8_V9,
    RC_C8_Va,
    RC_C8_Vb,
    RC_C8_Vc,
    RC_C8_Vd,
    RC_C8_Ve,
    RC_C8_Vf
};
int address = 0;
void instruction(char* str, ...)
{
    va_list ap;
    va_start(ap, str);
    printf("%3x ", address);
    printf(str, ap);
    printf("\n");
    va_end(ap);
    address += 2;
}
void unimplemented(char* str)
{
    printf("%s\n", str);
    exit(1);
}
void load(int r, SValue *sv)
{
    printf("LOAD register %d with constant %d\n",
            r, sv->c.ul);
    //print_svalue(sv);
    int v = sv->r & VT_VALMASK;
    /*if (sv->r & VT_LVAL) {
        unimplemented("lval\n");
    }
    else
    {
        if(v == VT_CONST)
            unimplemented("const\n");
        else if(v == VT_LOCAL)
            unimplemented("local\n");
        else
            unimplemented("else\n");
    }*/
    print_svalue(sv);
    instruction("load *%d,V%d, %d, %d",
            v, REG_VALUE(r), r, REG_VALUE(v));
}
void store(int r, SValue *sv)
{
    int v = sv->r & VT_VALMASK;
    print_svalue(sv);
    printf("STORE register %d with constant %d\n",
            sv->r & VT_VALMASK, r);
    instruction("store *%d,V%d, %d",
            v, REG_VALUE(r), r);
    /*instruction("store( *%d,V%d, %d",
            v, REG_VALUE(sv->r), r & VT_VALMASK);
    instruction("LD V%d,%d", REG_VALUE(sv->r), 42);*/
}
void gfunc_call(int nb_args)
{
    int i;
    Sym* sym;
    sym = get_sym_ref(&char_pointer_type, cur_text_section, ind + 12, 0);	// symbol for return address
    for(i = 0; i < nb_args; i++) {
        SValue *sv = vtop - i;
        print_svalue(sv);
        instruction("LD V0, V%d", REG_VALUE(sv->r));
        instruction("LD I, %d", 0xfff - 2 * (i + 1));
        instruction("LD [I], V0");
    }
    instruction("CALL %s", last_function);
}
void gfunc_prolog(CType *func_type)
{
    Sym *sym;
    CType *type;
    sym = func_type->ref;
    printf("%s:\n", funcname);
    int i = 1;
    while ((sym = sym->next) != NULL) {
        instruction("LD I, %d", 0xfff - 2 * i);
        instruction("LD V0, [I]");
        instruction("LD V%d, V0", i);
        /*sym_push(sym->v & ~SYM_FIELD, &sym->type,
                VT_LOCAL | VT_LVAL, 0);*/
        i++;
    }
}
void gfunc_epilog(void)
{
    // put return value in V0
    instruction("LD V0, V?");
}
#define IS_CONST(v) (((v)->r & (VT_VALMASK | VT_CONST)) == VT_CONST)
#define IS_SYM(v) (((v)->r & (VT_SYM)) == VT_SYM)
print_sym(Sym* sym)
{
    printf("Sym: token: %c, type: %d, asm_label: %s, ",
            sym->v, sym->type.t, sym->asm_label);
    printf("register: %d, number: %d\n",
            sym->r, sym->c);
}
print_svalue(SValue* v)
{
    int constant = IS_CONST(v);
    int sym = IS_SYM(v);
    printf("SValue: type: %d, register + flags: %d, register: %d, ",
            v->type.t,
            v->r,
            REG_VALUE(v->r));
    printf("r+f VTCONST %d, second register %d, constant: %d, sym: %d,",
            constant,
            v->r2,
            v->c,
            v->sym);
    if(constant) printf("constant = %d, ", v->c.i);
    if(sym) printf("sym.v = %d, sym.asm_label = %s",
            v->sym->v, v->sym->asm_label);
    printf("\n");
}
void gen_opi(int op)
{
    SValue* item1 = vtop - 1;
    SValue* item2 = vtop;
    print_svalue(item1);
    print_svalue(item2);
    switch(op)
    {
        case '+':
            if(IS_CONST(item2))
                instruction("ADD V%d,%d",
                        REG_VALUE(item1->r), item2->c.i);
            else instruction("ADD V%d,V%d",
                        (item1->r),
                        (item2->r));
            break;
        case '*':
            if(IS_CONST(item2))
                instruction("MUL V%d,%d",
                        REG_VALUE(item1->r), item2->c.i);
            else
                instruction("MUL V%d,V%d",
                        REG_VALUE(item1->r),
                        REG_VALUE(item2->r));
            break;
        default:
            unimplemented("unimplemented");
    }
}
void gen_opf(int op)
{
    unimplemented("gen_opf\n");
}
void gen_cvt_itof(int t)
{
    unimplemented("gen_cvt_itof\n");
}
void gen_cvt_ftoi(int t)
{
    unimplemented("gen_cvt_ftoi\n");
}
void gen_cvt_ftof(int t)
{
    unimplemented("gen_cvt_ftof\n");
}
void gen_bounded_ptr_add(void)
{
    unimplemented("gen_bounded_ptr_add\n");
}
void gen_bounded_ptr_deref(void)
{
    unimplemented("gen_bounded_ptr_deref\n");
}
int gtst(int inv, int t)
{
    unimplemented("gtst\n");
}
/* output a symbol and patch all calls to it */
void gsym_addr(int t, int a)
{
    int n, *ptr;
    while (t) {
        ptr = (int *)(cur_text_section->data + t);
        n = *ptr; /* next value */
        *ptr = a - t - 4;
        t = n;
    }
}
void gsym(int t)
{
    gsym_addr(t, ind);
}
int gjmp(int t)
{
    if(!t) instruction("RET");
}
void gjmp_addr(int a)
{
    instruction("JP %d", a);
}
void ggoto(void)
{
    unimplemented("ggoto\n");
}
void g(int c)
{
    int ind1;
    ind1 = ind + 1;
    if (ind1 > cur_text_section->data_allocated)
        section_realloc(cur_text_section, ind1);
    cur_text_section->data[ind] = c;
    ind = ind1;
}

#endif
