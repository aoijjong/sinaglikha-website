/*
  The name to use in a greeting ("Hello, Maria"), shared by the Employee Portal and the Senior Manager portal.
    "Zablan, Gwyneth A."   ->  "Gwyneth"      names written Last, First: the first name is what follows the comma
    "Maria Santos"         ->  "Maria"
    "Dr. Maria Santos"     ->  "Dr. Maria"    an honorific stays with the name that follows it
    "Santos, Dr. Maria"    ->  "Dr. Maria"
    "Atty. Rosales, Athea" ->  "Atty. Athea"
  Suffixes such as Jr. or III are never taken for a first name.
*/
(function () {
  'use strict';
  var HONORIFIC = /^(dr|dra|engr|atty|arch|prof|mr|mrs|ms|mx|hon|rev|fr|sen|rep|gov|capt)\.?$/i;
  var SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;

  function greetName(full) {
    var s = String(full || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    var comma = s.indexOf(',');
    var given = comma !== -1 ? s.slice(comma + 1).trim() : s;
    // "Santos, Maria, Dr." or "Santos, Maria, Jr.": only the part right after the first comma matters
    given = given.split(',')[0].trim();
    var words = given.split(' ').filter(Boolean);
    if (!words.length) words = s.split(' ').filter(Boolean);
    // leading honorifics ("Prof. Dr.") stay with the first name after them
    var k = 0, titles = [];
    while (k < words.length - 1 && HONORIFIC.test(words[k])) { titles.push(words[k]); k++; }
    if (titles.length && words[k] && !SUFFIX.test(words[k])) return titles.concat(words[k]).join(' ');
    // an honorific written before the comma ("Atty. Rosales, Athea") still goes with the first name
    var lead = comma !== -1 ? s.slice(0, comma).split(' ')[0] : '';
    if (lead && HONORIFIC.test(lead) && words[0] && !HONORIFIC.test(words[0])) return lead + ' ' + words[0];
    return words[0] || '';
  }

  window.SngGreetName = greetName;
})();
