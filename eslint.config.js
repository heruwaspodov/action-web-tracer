import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['dist/', 'node_modules/'],
	},
	eslint.configs.recommended,
	tseslint.configs.recommended,
	{
		files: ['**/*.ts'],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				chrome: 'readonly',
			},
		},
	},
	{
		files: ['test-fixtures/app/**/*.js'],
		languageOptions: {
			globals: globals.browser,
		},
	},
	{
		files: ['test-fixtures/**/*.mjs'],
		languageOptions: {
			globals: globals.node,
		},
	},
);
