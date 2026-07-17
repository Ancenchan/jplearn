async function loadAnalysisBundle({ fetchJSON, dataBase, songId, versionId }) {
  const manifestPath = `${dataBase}/analysis/${songId}/${versionId}.json`;
  const linesPath = `${dataBase}/analysis/${songId}/${versionId}.lines.json`;
  
  const [manifest, linesDoc] = await Promise.all([
    fetchJSON(manifestPath),
    fetchJSON(linesPath)
  ]);

  return {
    ...manifest,
    lines: linesDoc.lines || [],
    sentences: linesDoc.sentences || []
  };
}

module.exports = { loadAnalysisBundle };
