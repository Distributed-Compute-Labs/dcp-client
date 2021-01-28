exports.reverse = function reverser$$reverse(str) {
  var s = '';
  for (let i=str.length; i > 0; i--) {
    s += str[i-1];
  }
  return s;
}
