/**
 * Hand the player a file.
 *
 * Three lines of it are obvious and one is not, which is the whole reason
 * this is shared rather than written out twice: the object URL has to
 * outlive the click. Revoking it on the next line cancels the download in
 * browsers that have not consumed the Blob yet, so it is released on the
 * next task instead -- and a second copy of this code is a second chance to
 * leave that out.
 */
export function saveFile(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
