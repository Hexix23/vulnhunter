struct S {
  data : vec3<bool>,
}

var<workgroup> wg : array<S, 2>;

@compute @workgroup_size(1)
fn main(@builtin(local_invocation_id) lid : vec3<u32>) {
  let i = lid.x & 1u;
  let b = wg[i].data.y;
  wg[1u - i].data.z = b;
}
