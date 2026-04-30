var<workgroup> wg : array<vec3<bool>, 2>;

fn touch(p : ptr<workgroup, array<vec3<bool>, 2>, read_write>, i : u32) {
  let b = (*p)[i].x;
  (*p)[1u - i].z = b;
}

@compute @workgroup_size(1)
fn main(@builtin(local_invocation_id) lid : vec3<u32>) {
  touch(&wg, lid.x & 1u);
}
