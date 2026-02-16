import { describe, it, expect } from 'vitest';
import { helloWorld } from '../helloWorld.js';

describe('helloWorld', () => {
  it('should return "Hello, World!" when no name is provided', () => {
    const result = helloWorld();
    expect(result).toBe('Hello, World!');
  });

  it('should return "Hello, <name>!" when a name is provided', () => {
    const result = helloWorld('Claude');
    expect(result).toBe('Hello, Claude!');
  });

  it('should handle empty string', () => {
    const result = helloWorld('');
    expect(result).toBe('Hello, !');
  });

  it('should handle special characters in name', () => {
    const result = helloWorld('测试用户');
    expect(result).toBe('Hello, 测试用户!');
  });
});
