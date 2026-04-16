// Minimal link probe for the Python UnknownFieldSet path.
// The vulnerable function is implemented in targets/protobuf/python/unknown_fields.c.
// If this symbol is absent from the prebuilt ASan artifacts, this build cannot validate
// the finding and needs a Python extension build instead of the native C++ libraries.
extern "C" void* PyUpb_UnknownFieldSet_NewBare(void);

int main() {
  return PyUpb_UnknownFieldSet_NewBare() ? 0 : 1;
}
