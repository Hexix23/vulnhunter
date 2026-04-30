// Paste into:
// third_party/dawn/src/tint/lang/msl/writer/raise/fix_type_layout_test.cc
//
// These are variant probes for CVE-2026-7346 / crbug.com/505317119.
// They intentionally target shapes not covered by ArrayVec3Bool.

TEST_F(MslWriter_FixTypeLayoutTest, ArrayVec3Bool_NestedArray_ElementLoadStore) {
    auto* inner = ty.array(ty.vec3<bool>(), 2);
    auto* outer = ty.array(inner, 2);
    auto* var = b.Var("v", ty.ptr<workgroup>(outer));
    mod.root_block->Append(var);

    auto* func = b.Function("foo", ty.void_());
    b.Append(func->Block(), [&] {
        auto* ptr = b.Access(ty.ptr(workgroup, ty.vec3<bool>(), read_write), var, 0_u, 1_u);
        auto* el = b.LoadVectorElement(ptr, 0_u);
        b.StoreVectorElement(ptr, 2_u, el);
        b.Return(func);
    });

    Run();
    EXPECT_THAT(str(), HasSubstr("array<array<tint_packed_vec3_u32_array_element, 2>, 2>"));
    EXPECT_THAT(str(), HasSubstr("access %v, 0u, 1u, 0u"));
    EXPECT_THAT(str(), HasSubstr("load_vector_element"));
    EXPECT_THAT(str(), HasSubstr(":u32 = load_vector_element"));
    EXPECT_THAT(str(), HasSubstr(":bool = convert"));
}

TEST_F(MslWriter_FixTypeLayoutTest, ArrayVec3Bool_NestedArray_WholeLoadStore) {
    auto* inner = ty.array(ty.vec3<bool>(), 2);
    auto* outer = ty.array(inner, 2);
    auto* var = b.Var("v", ty.ptr<workgroup>(outer));
    mod.root_block->Append(var);

    auto* func = b.Function("foo", ty.void_());
    b.Append(func->Block(), [&] {
        auto* value = b.Load(var);
        b.Store(var, value);
        b.Return(func);
    });

    Run();
    EXPECT_THAT(str(), HasSubstr("tint_load_array_packed_vec3"));
    EXPECT_THAT(str(), HasSubstr("tint_store_array_packed_vec3"));
    EXPECT_THAT(str(), HasSubstr("tint_packed_vec3_u32_array_element"));
    EXPECT_THAT(str(), Not(HasSubstr("__packed_vec3<bool>")));
}

TEST_F(MslWriter_FixTypeLayoutTest, ArrayVec3Bool_StructContainingArray) {
    auto* arr = ty.array(ty.vec3<bool>(), 2);
    auto* s = ty.Struct(mod.symbols.New("S"), {{mod.symbols.Register("data"), arr}});
    auto* var = b.Var("v", ty.ptr<workgroup>(s));
    mod.root_block->Append(var);

    auto* func = b.Function("foo", ty.void_());
    b.Append(func->Block(), [&] {
        auto* ptr = b.Access(ty.ptr(workgroup, ty.vec3<bool>(), read_write), var, 0_u, 1_u);
        auto* el = b.LoadVectorElement(ptr, 1_u);
        b.StoreVectorElement(ptr, 2_u, el);
        b.Return(func);
    });

    Run();
    EXPECT_THAT(str(), HasSubstr("S_packed_vec3"));
    EXPECT_THAT(str(), HasSubstr("array<tint_packed_vec3_u32_array_element, 2>"));
    EXPECT_THAT(str(), HasSubstr("access %v, 0u, 1u, 0u"));
    EXPECT_THAT(str(), Not(HasSubstr("__packed_vec3<bool>")));
}

TEST_F(MslWriter_FixTypeLayoutTest, ArrayVec3Bool_ArrayOfStructContainingVec3Bool) {
    auto* s = ty.Struct(mod.symbols.New("S"), {{mod.symbols.Register("data"), ty.vec3<bool>()}});
    auto* arr = ty.array(s, 2);
    auto* var = b.Var("v", ty.ptr<workgroup>(arr));
    mod.root_block->Append(var);

    auto* func = b.Function("foo", ty.void_());
    b.Append(func->Block(), [&] {
        auto* ptr = b.Access(ty.ptr(workgroup, ty.vec3<bool>(), read_write), var, 1_u, 0_u);
        auto* el = b.LoadVectorElement(ptr, 1_u);
        b.StoreVectorElement(ptr, 2_u, el);
        b.Return(func);
    });

    Run();
    EXPECT_THAT(str(), HasSubstr("array<S_packed_vec3, 2>"));
    EXPECT_THAT(str(), HasSubstr("data:__packed_vec3<u32>"));
    EXPECT_THAT(str(), HasSubstr("access %v, 1u, 0u"));
    EXPECT_THAT(str(), Not(HasSubstr("__packed_vec3<bool>")));
}

TEST_F(MslWriter_FixTypeLayoutTest, ArrayVec3Bool_PointerParameter) {
    auto* arr = ty.array(ty.vec3<bool>(), 2);
    auto* ptr = ty.ptr(workgroup, arr, read_write);
    auto* func = b.Function("touch", ty.void_());
    auto* param = b.FunctionParam("p", ptr);
    func->SetParams({param});
    b.Append(func->Block(), [&] {
        auto* el_ptr = b.Access(ty.ptr(workgroup, ty.vec3<bool>(), read_write), param, 0_u);
        auto* el = b.LoadVectorElement(el_ptr, 0_u);
        b.StoreVectorElement(el_ptr, 1_u, el);
        b.Return(func);
    });

    Run();
    EXPECT_THAT(str(), HasSubstr("%p:ptr<workgroup, array<tint_packed_vec3_u32_array_element, 2>, read_write>"));
    EXPECT_THAT(str(), HasSubstr("access %p, 0u, 0u"));
    EXPECT_THAT(str(), Not(HasSubstr("__packed_vec3<bool>")));
}
