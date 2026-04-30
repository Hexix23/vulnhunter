var<workgroup> wg : array<array<vec3<bool>, 2>, 2>;

@compute @workgroup_size(1)
fn main(@builtin(local_invocation_id) lid : vec3<u32>) {
  let i = lid.x & 1u;
  let j = (lid.x + 1u) & 1u;
  let x = wg[i][j].x;
  wg[j][i].y = x;
}
