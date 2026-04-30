struct S {
  data : array<vec3<bool>, 2>,
}

var<workgroup> wg : S;

@compute @workgroup_size(1)
fn main(@builtin(local_invocation_id) lid : vec3<u32>) {
  let i = lid.x & 1u;
  let b = wg.data[i].z;
  wg.data[1u - i].x = b;
}
