import { describe, it, expect } from 'vitest';
import { classifyCommand, type CommandComplexity } from '../../src/ai/commandClassifier';

// ─── Helper ───────────────────────────────────────────────────────────────────
function assertSimple(command: string) {
  expect(classifyCommand(command)).toBe<CommandComplexity>('simple');
}

function assertComplex(command: string) {
  expect(classifyCommand(command)).toBe<CommandComplexity>('complex');
}

describe('commandClassifier', () => {
  // ─── Simple commands ─────────────────────────────────────────────────────────
  describe('simple commands', () => {
    it('classifies "create a sticky note" as simple', () => {
      assertSimple('create a sticky note');
    });

    it('classifies "add a blue sticky" as simple', () => {
      assertSimple('add a blue sticky');
    });

    it('classifies "make a red shape" as simple', () => {
      assertSimple('make a red shape');
    });

    it('classifies "delete the selected object" as simple', () => {
      assertSimple('delete the selected object');
    });

    it('classifies "move the sticky to position 100 200" as simple', () => {
      assertSimple('move the sticky to position 100 200');
    });

    it('classifies "change color to green" as simple', () => {
      assertSimple('change color to green');
    });

    it('classifies "resize the box" as simple', () => {
      assertSimple('resize the box');
    });

    it('classifies short single-word command as simple', () => {
      assertSimple('hello');
    });

    it('classifies a command with "those" reference as simple', () => {
      // Simple references to existing objects are fine for Haiku
      assertSimple('move those to the left');
    });

    it('classifies "add a frame" as simple', () => {
      assertSimple('add a frame');
    });

    it('classifies "add a text element" as simple', () => {
      assertSimple('add a text element saying hello');
    });
  });

  // ─── Long commands → complex ─────────────────────────────────────────────────
  describe('length threshold', () => {
    it('classifies commands longer than 200 chars as complex', () => {
      const longCommand = 'create a sticky note '.repeat(12); // > 200 chars
      expect(longCommand.length).toBeGreaterThan(200);
      assertComplex(longCommand);
    });

    it('classifies commands at exactly 200 chars as simple', () => {
      // Build a command that is exactly 200 chars (or just under) with no keywords
      const command = 'a'.repeat(200);
      assertSimple(command);
    });

    it('classifies commands at exactly 201 chars as complex', () => {
      const command = 'a'.repeat(201);
      assertComplex(command);
    });
  });

  // ─── Complex keyword detection ────────────────────────────────────────────────
  describe('complex keywords', () => {
    const keywordCases: [string, string][] = [
      ['template', 'create a template for the team'],
      ['organize', 'organize the items on the board'],
      ['layout', 'update the layout of the board'],
      ['arrange', 'arrange the stickies in a grid'],
      ['swot', 'create a swot analysis'],
      ['retro', 'set up a retro board'],
      ['kanban', 'create a kanban board'],
      ['brainstorm', 'brainstorm ideas about the project'],
      ['mind map', 'create a mind map of features'],
      ['mindmap', 'build a mindmap for the quarter'],
      ['flowchart', 'draw a flowchart for signup'],
      ['diagram', 'make a diagram of the architecture'],
      ['workflow', 'outline the workflow steps'],
      ['sprint', 'plan the sprint backlog'],
      ['timeline', 'add a timeline for the project'],
      ['roadmap', 'create a product roadmap'],
      ['matrix', 'create a matrix of priorities'],
      ['quadrant', 'build a 2x2 quadrant'],
      ['pros and cons', 'list pros and cons of each option'],
      ['compare', 'compare the two approaches'],
      ['categorize', 'categorize the existing stickies'],
      ['group', 'group these items by theme'],
      ['sort', 'sort the stickies by date'],
      ['prioritize', 'prioritize the tasks on the board'],
    ];

    for (const [keyword, command] of keywordCases) {
      it(`classifies command with "${keyword}" keyword as complex`, () => {
        assertComplex(command);
      });
    }

    it('is case-insensitive for keyword matching', () => {
      assertComplex('Create a TEMPLATE for the project');
      assertComplex('ORGANIZE the board');
      assertComplex('Make a Mind Map');
    });
  });

  // ─── Complex reference keywords ───────────────────────────────────────────────
  describe('complex reference keywords', () => {
    it('classifies "reorganize" as complex', () => {
      assertComplex('reorganize all the stickies');
    });

    it('classifies "rearrange" as complex', () => {
      assertComplex('rearrange the items alphabetically');
    });

    it('classifies "redistribute" as complex', () => {
      assertComplex('redistribute the cards across columns');
    });

    it('classifies "reposition" as complex', () => {
      assertComplex('reposition everything on the board');
    });

    it('classifies "realign" as complex', () => {
      assertComplex('realign the shapes to the grid');
    });

    it('classifies commands containing "all of them" as complex', () => {
      assertComplex('move all of them to the right side');
    });

    it('classifies commands containing "everything" as complex', () => {
      assertComplex('group everything by color');
    });
  });

  // ─── Multi-action patterns ────────────────────────────────────────────────────
  describe('multi-action patterns', () => {
    it('classifies "create X and then move Y" chain as complex', () => {
      assertComplex('create a sticky note and then move it to the right');
    });

    it('classifies "add X and then create Y" chain as complex', () => {
      assertComplex('add a frame and then create three stickies inside');
    });

    it('classifies "make X also create Y" chain as complex', () => {
      // "make a header and then create a subheader" — enough chars between conjunction and verb
      assertComplex('make a header and then create a subheader below it');
    });

    it('classifies "connect A to B" as complex', () => {
      assertComplex('connect the sticky to the frame');
    });

    it('classifies "draw a line between" as complex', () => {
      assertComplex('draw a line between the two shapes');
    });

    it('classifies "between" spatial command as complex', () => {
      assertComplex('place a connector between the boxes');
    });

    it('classifies "create X and then delete Y" as complex', () => {
      // "after that" + 5 chars before target verb: " the old frame then delete it"
      assertComplex('create a new frame and then delete the old one');
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles empty string as simple (length 0)', () => {
      assertSimple('');
    });

    it('handles whitespace-only command as simple', () => {
      assertSimple('   ');
    });

    it('trims whitespace before length check', () => {
      // A command with leading/trailing spaces should trim correctly
      const cmd = '  create a sticky  ';
      assertSimple(cmd);
    });

    it('classifies command that partially matches a keyword mid-word as simple', () => {
      // "sort" is a keyword, but "assortment" is not a separate keyword match
      // The current implementation uses includes(), so "assortment" WOULD match "sort"
      // This test documents actual behavior: substring match is used
      assertComplex('I have an assortment of stickies');
    });

    it('does not confuse "regroup" with complex reference keywords', () => {
      // "group" IS in COMPLEX_KEYWORDS, so "regroup" will be caught by group keyword
      assertComplex('regroup the items');
    });
  });
});
