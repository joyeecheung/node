'use strict';

var re = /./;
re.exec = function () {
  var result = [];
  result.groups = { a: '7' };
  return result;
};
''.replace(re, '$<a>') !== '7';
