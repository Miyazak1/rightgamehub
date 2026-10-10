"use strict";
// Tests for the CSV importer. Run with: node --test
const { test } = require('node:test');
const assert = require('node:assert');
const { parseCsvQuestions } = require('../src/importers/csv.js');

// A minimal valid header used by most cases.
const HEADER = 'id,category,type,theme,primaryQuestion,primaryAnswer,secondaryQuestion,secondaryAnswer,imagePath,draw';

test('parses a basic row into the expected shape', () => {
  const csv = HEADER + '\n' +
    'Q1,General,main,Geo,What is 1+1?,2,,,,';
  const { questions, warnings } = parseCsvQuestions(csv);
  assert.strictEqual(questions.length, 1);
  assert.strictEqual(warnings.length, 0);
  const q = questions[0];
  assert.strictEqual(q.id, 'Q1');
  assert.strictEqual(q.category, 'General');
  assert.strictEqual(q.type, 'main');
  assert.strictEqual(q.primaryQuestion, 'What is 1+1?');
  assert.strictEqual(q.primaryAnswer, '2');
  assert.strictEqual(q.draw, null);
});

test('keeps commas that sit inside quoted fields', () => {
  const csv = HEADER + '\n' +
    'Q1,General,main,Geo,"Lions, tigers, and bears?","Oh, my",,,,';
  const { questions } = parseCsvQuestions(csv);
  assert.strictEqual(questions[0].primaryQuestion, 'Lions, tigers, and bears?');
  assert.strictEqual(questions[0].primaryAnswer, 'Oh, my');
});

test('unescapes doubled double-quotes inside a field', () => {
  const csv = HEADER + '\n' +
    'Q1,General,main,Music,"Who wrote ""Hey Jude""?","The Beatles",,,,';
  const { questions } = parseCsvQuestions(csv);
  assert.strictEqual(questions[0].primaryQuestion, 'Who wrote "Hey Jude"?');
});

test('parses an explicit draw number as an integer', () => {
  const csv = HEADER + '\n' +
    'Q1,General,main,Geo,Q?,A,,,,3';
  const { questions } = parseCsvQuestions(csv);
  assert.strictEqual(questions[0].draw, 3);
});

test('warns when a required column is missing', () => {
  // No primaryAnswer column.
  const csv = 'id,category,type,primaryQuestion\n' +
    'Q1,General,main,Q?';
  const { warnings } = parseCsvQuestions(csv);
  assert.ok(warnings.some((w) => w.includes('primaryAnswer')));
});

test('defaults an unknown type to "main" and warns', () => {
  const csv = HEADER + '\n' +
    'Q1,General,bonus,Geo,Q?,A,,,,';
  const { questions, warnings } = parseCsvQuestions(csv);
  assert.strictEqual(questions[0].type, 'main');
  assert.ok(warnings.some((w) => w.includes('unknown type')));
});

test('skips a row with an empty id and warns', () => {
  const csv = HEADER + '\n' +
    ',General,main,Geo,Q?,A,,,,';
  const { questions, warnings } = parseCsvQuestions(csv);
  assert.strictEqual(questions.length, 0);
  assert.ok(warnings.some((w) => w.includes('empty id')));
});

test('reports an empty file with only a header', () => {
  const { questions, warnings } = parseCsvQuestions(HEADER);
  assert.strictEqual(questions.length, 0);
  assert.ok(warnings.length > 0);
});
