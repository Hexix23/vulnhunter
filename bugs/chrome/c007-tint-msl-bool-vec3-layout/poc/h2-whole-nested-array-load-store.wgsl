var<workgroup> wg : array<array<vec3<bool>, 2>, 2>;

@compute @workgroup_size(1)
fn main() {
  let tmp = wg;
  wg = tmp;
}
