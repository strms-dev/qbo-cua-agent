import { supabase } from './supabase';

/**
 * Memory Tool Handler Implementation
 *
 * Implements Anthropic's 6 memory commands for the memory tool:
 * - view: Read a memory file
 * - create: Create a new memory file
 * - str_replace: Replace unique string in a file
 * - insert: Insert text at a specific line
 * - delete: Remove a memory file
 * - rename: Rename/move a memory file
 *
 * Backend: Supabase database (memory_files table)
 * File structure: One file per task_id (/memories/{task_id})
 */
export class MemoryToolHandlers {

  /**
   * VIEW: Read a memory file
   * Command: { "command": "view", "path": "/memories/abc-123-def" }
   *
   * @param path - Task ID or path (with or without /memories/ prefix)
   * @returns File content as string
   * @throws Error if file not found
   */
  async view(path: string): Promise<string> {
    console.log(`📖 Memory view: ${path}`);

    const normalizedPath = this.normalizePath(path);

    const { data, error } = await supabase
      .from('memory_files')
      .select('content')
      .eq('file_path', normalizedPath)
      .single();

    if (error || !data) {
      throw new Error(`File not found: ${path}`);
    }

    console.log(`✅ Memory view successful: ${normalizedPath} (${data.content.length} chars)`);
    return data.content;
  }

  /**
   * CREATE: Create a new memory file
   * Command: { "command": "create", "path": "/memories/abc-123", "file_text": "content" }
   *
   * @param path - Task ID or path
   * @param fileText - Content to write
   * @throws Error if file already exists
   */
  async create(path: string, fileText: string): Promise<void> {
    console.log(`✍️ Memory create: ${path}`);

    const normalizedPath = this.normalizePath(path);

    // Check if file already exists
    const { data: existing } = await supabase
      .from('memory_files')
      .select('id')
      .eq('file_path', normalizedPath)
      .single();

    if (existing) {
      throw new Error(`File already exists: ${path}`);
    }

    const { error } = await supabase
      .from('memory_files')
      .insert({
        file_path: normalizedPath,
        content: fileText
      });

    if (error) {
      throw new Error(`Failed to create file: ${error.message}`);
    }

    console.log(`✅ Memory created: ${normalizedPath} (${fileText.length} chars)`);
  }

  /**
   * STR_REPLACE: Replace a unique string in a file
   * Command: { "command": "str_replace", "path": "...", "old_str": "foo", "new_str": "bar" }
   *
   * Note: old_str must appear exactly once in the file (Anthropic requirement)
   *
   * @param path - Task ID or path
   * @param oldStr - String to find (must be unique)
   * @param newStr - Replacement string
   * @throws Error if string not found or appears multiple times
   */
  async strReplace(path: string, oldStr: string, newStr: string): Promise<void> {
    console.log(`🔄 Memory str_replace: ${path}`);
    console.log(`   Replace: "${oldStr.substring(0, 50)}${oldStr.length > 50 ? '...' : ''}"`);
    console.log(`   With: "${newStr.substring(0, 50)}${newStr.length > 50 ? '...' : ''}"`);

    const content = await this.view(path);

    // Check if old_str exists and is unique (Anthropic requirement)
    const occurrences = content.split(oldStr).length - 1;
    if (occurrences === 0) {
      throw new Error(`String not found: "${oldStr}"`);
    }
    if (occurrences > 1) {
      throw new Error(`String "${oldStr}" appears ${occurrences} times - must be unique`);
    }

    const newContent = content.replace(oldStr, newStr);

    const { error } = await supabase
      .from('memory_files')
      .update({
        content: newContent,
        updated_at: new Date().toISOString()
      })
      .eq('file_path', this.normalizePath(path));

    if (error) {
      throw new Error(`Failed to update file: ${error.message}`);
    }

    console.log(`✅ Memory str_replace successful: ${path}`);
  }

  /**
   * INSERT: Insert text at a specific line number
   * Command: { "command": "insert", "path": "...", "insert_line": 5, "new_str": "text" }
   *
   * @param path - Task ID or path
   * @param insertLine - Line number to insert at (0-indexed)
   * @param newStr - Text to insert
   * @throws Error if line number is invalid
   */
  async insert(path: string, insertLine: number, newStr: string): Promise<void> {
    console.log(`➕ Memory insert: ${path} at line ${insertLine}`);
    console.log(`   Inserting: "${newStr.substring(0, 50)}${newStr.length > 50 ? '...' : ''}"`);

    const content = await this.view(path);
    const lines = content.split('\n');

    if (insertLine < 0 || insertLine > lines.length) {
      throw new Error(`Invalid line number: ${insertLine} (file has ${lines.length} lines)`);
    }

    lines.splice(insertLine, 0, newStr);
    const newContent = lines.join('\n');

    const { error } = await supabase
      .from('memory_files')
      .update({
        content: newContent,
        updated_at: new Date().toISOString()
      })
      .eq('file_path', this.normalizePath(path));

    if (error) {
      throw new Error(`Failed to insert text: ${error.message}`);
    }

    console.log(`✅ Memory insert successful: ${path}`);
  }

  /**
   * DELETE: Remove a memory file
   * Command: { "command": "delete", "path": "..." }
   *
   * @param path - Task ID or path
   * @throws Error if deletion fails
   */
  async delete(path: string): Promise<void> {
    console.log(`🗑️ Memory delete: ${path}`);

    const { error } = await supabase
      .from('memory_files')
      .delete()
      .eq('file_path', this.normalizePath(path));

    if (error) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }

    console.log(`✅ Memory deleted: ${path}`);
  }

  /**
   * RENAME: Rename or move a memory file
   * Command: { "command": "rename", "path": "old-task-id", "new_path": "new-task-id" }
   *
   * @param oldPath - Current task ID or path
   * @param newPath - New task ID or path
   * @throws Error if rename fails
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    console.log(`📝 Memory rename: ${oldPath} → ${newPath}`);

    const { error } = await supabase
      .from('memory_files')
      .update({
        file_path: this.normalizePath(newPath),
        updated_at: new Date().toISOString()
      })
      .eq('file_path', this.normalizePath(oldPath));

    if (error) {
      throw new Error(`Failed to rename file: ${error.message}`);
    }

    console.log(`✅ Memory renamed: ${oldPath} → ${newPath}`);
  }

  /**
   * LIST: List all memory files (helper method for debugging/management)
   * Not part of Anthropic's 6 commands, but useful for administration
   *
   * @returns Array of file paths (task IDs)
   */
  async list(): Promise<string[]> {
    console.log(`📋 Memory list: fetching all memory files`);

    const { data, error } = await supabase
      .from('memory_files')
      .select('file_path')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list files: ${error.message}`);
    }

    const paths = data?.map(d => d.file_path) || [];
    console.log(`✅ Memory list: found ${paths.length} files`);
    return paths;
  }

  /**
   * Normalize file path by removing /memories/ prefix if present
   * Agent may send: "/memories/{task_id}" or just "{task_id}"
   * We store without /memories/ prefix for consistency
   *
   * @param path - Path with or without /memories/ prefix
   * @returns Normalized path (just the task_id)
   *
   * Examples:
   *   "/memories/abc-123-def" → "abc-123-def"
   *   "abc-123-def" → "abc-123-def"
   */
  private normalizePath(path: string): string {
    return path.replace(/^\/memories\//, '');
  }
}
