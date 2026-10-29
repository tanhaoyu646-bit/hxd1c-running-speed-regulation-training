const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (value) => Math.hypot(value[0], value[1], value[2]);
const normalize = (value, fallback = [0, 0, 1]) => {
  const magnitude = length(value);
  return magnitude > 1e-7 ? value.map((item) => item / magnitude) : [...fallback];
};

function desiredTangent(points, index) {
  if (index === 0) return normalize(subtract(points[1], points[0]));
  if (index === points.length - 1) return normalize(subtract(points[index], points[index - 1]));
  return normalize(subtract(points[index + 1], points[index - 1]));
}

function normalizeVerticalProfile(points, maximumGrade = 35, recoveryDistance = 1800) {
  const adjusted = points.map((point) => [...point]);
  const chainage = [0];
  const grades = [];
  for (let index = 1; index < points.length; index += 1) {
    const horizontal = Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][2] - points[index - 1][2],
    );
    chainage.push(chainage[index - 1] + horizontal);
    grades.push(horizontal > 0.001 ? (points[index][1] - points[index - 1][1]) / horizontal * 1000 : 0);
  }
  for (let segment = 1; segment < grades.length - 1; segment += 1) {
    const grade = grades[segment];
    const before = grades[segment - 1];
    const after = grades[segment + 1];
    if (Math.abs(grade) <= maximumGrade
      || Math.abs(before) > maximumGrade
      || Math.abs(after) > maximumGrade
      || Math.sign(before) !== Math.sign(grade)
      || Math.sign(after) !== Math.sign(grade)) continue;
    const startIndex = segment;
    const endIndex = segment + 1;
    const horizontal = chainage[endIndex] - chainage[startIndex];
    const expectedGrade = (before + after) * 0.5;
    const expectedDelta = expectedGrade / 1000 * horizontal;
    const actualDelta = points[endIndex][1] - points[startIndex][1];
    const excessDelta = actualDelta - expectedDelta;
    if (Math.abs(excessDelta) < 0.08) continue;
    const recoveryEnd = chainage[endIndex] + recoveryDistance;
    for (let index = startIndex + 1; index < adjusted.length; index += 1) {
      const distance = chainage[index];
      if (distance <= chainage[endIndex]) {
        const ratio = (distance - chainage[startIndex]) / horizontal;
        adjusted[index][1] -= excessDelta * ratio;
      } else if (distance < recoveryEnd) {
        adjusted[index][1] -= excessDelta * (1 - (distance - chainage[endIndex]) / recoveryDistance);
      } else break;
    }
  }
  return adjusted;
}

function hermitePoint(start, end, startTangent, endTangent, scale, ratio) {
  const t2 = ratio * ratio;
  const t3 = t2 * ratio;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + ratio;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const point = [
    h00 * start[0] + h10 * startTangent[0] * scale + h01 * end[0] + h11 * endTangent[0] * scale,
    0,
    h00 * start[2] + h10 * startTangent[2] * scale + h01 * end[2] + h11 * endTangent[2] * scale,
  ];
  // 平面 X/Z 用有序 TrackDB 节点的切线恢复曲线。高程按节点线性插值，
  // 不使用 TrackObj 姿态作垂向 Hermite 切线，避免坡变点过冲。
  point[1] = start[1] + (end[1] - start[1]) * ratio;
  return point;
}

export function buildRailAlignedPath(flatPositions, instances, options = {}) {
  if (!Array.isArray(flatPositions) || flatPositions.length < 6 || flatPositions.length % 3 !== 0) {
    throw new Error('轨道中心线数据格式无效');
  }
  const spacing = Math.max(2, Number(options.spacing) || 5);
  let controls = Array.from(
    { length: flatPositions.length / 3 },
    (_, index) => flatPositions.slice(index * 3, index * 3 + 3),
  );
  if (options.normalizeVerticalProfile) {
    controls = normalizeVerticalProfile(
      controls,
      Math.max(20, Number(options.maximumGrade) || 35),
      Math.max(500, Number(options.recoveryDistance) || 1800),
    );
  }
  // 轨道实例的世界姿态中包含原 MSTS 竖曲线的构件旋转，导出到 WebGL 后
  // 局部与 TrackDB 节点高程相差数米。用这些姿态反推切线会把中心线拉偏，
  // 表现为线路左右摇摆和“坐过山车”。切线只由有序 TrackDB 控制点计算，
  // instances 参数仅为保持 API 兼容。
  void instances;
  const tangents = controls.map((point, index) => desiredTangent(controls, index));
  const points = [controls[0]];
  for (let index = 1; index < controls.length; index += 1) {
    const start = controls[index - 1];
    const end = controls[index];
    const chord = subtract(end, start);
    const chordLength = length(chord);
    if (chordLength < 1e-6) continue;
    const chordDirection = normalize(chord);
    const startTangent = dot(tangents[index - 1], chordDirection) < 0
      ? tangents[index - 1].map((value) => -value)
      : tangents[index - 1];
    const endTangent = dot(tangents[index], chordDirection) < 0
      ? tangents[index].map((value) => -value)
      : tangents[index];
    const sampleCount = Math.max(1, Math.ceil(chordLength / spacing));
    for (let sample = 1; sample <= sampleCount; sample += 1) {
      points.push(hermitePoint(start, end, startTangent, endTangent, chordLength, sample / sampleCount));
    }
  }
  return points;
}

export function cumulativePathDistances(points) {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1] + length(subtract(points[index], points[index - 1])));
  }
  return distances;
}
