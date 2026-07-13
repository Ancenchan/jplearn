async function loadAnalysisBundle({ fetchJSON, dataBase, songId, versionId }) {
  const manifestPath = `${dataBase}/analysis/${songId}/${versionId}.json`;
  const manifest = await fetchJSON(manifestPath);

  if (Array.isArray(manifest.lines) && Array.isArray(manifest.sentences)) {
    return manifest;
  }

  const partPaths = manifest.parts || {};
  const [linesDoc, sentencesDoc] = await Promise.all([
    partPaths.lines ? fetchJSON(`${dataBase}/analysis/${songId}/${partPaths.lines}`) : Promise.resolve({ lines: [] }),
    partPaths.sentences ? fetchJSON(`${dataBase}/analysis/${songId}/${partPaths.sentences}`) : Promise.resolve({ sentences: [] })
  ]);

  return {
    ...manifest,
    lines: linesDoc.lines || [],
    sentences: sentencesDoc.sentences || []
  };
}

module.exports = { loadAnalysisBundle };
