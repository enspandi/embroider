import { removeSync, mkdtempSync, writeFileSync, ensureDirSync } from 'fs-extra';
import { join, dirname } from 'path';
import Options, { optionsWithDefaults } from '../src/options';
import sortBy from 'lodash/sortBy';
import { tmpdir } from 'os';
import { TemplateCompiler, expectWarning, throwOnWarnings } from '@embroider/core';
import { emberTemplateCompilerPath } from '@embroider/test-support';
import Resolver from '../src/resolver';
import { PackageRules } from '../src';

const compilerPath = emberTemplateCompilerPath();

describe('compat-resolver', function() {
  let appDir: string;
  let assertWarning: (pattern: RegExp, fn: () => void) => void;

  function configure(options: Options, podModulePrefix?: string) {
    let EmberENV = {};
    let plugins = { ast: [] };
    appDir = mkdtempSync(join(tmpdir(), 'embroider-compat-tests-'));
    let resolver = new Resolver({
      root: appDir,
      modulePrefix: 'the-app',
      podModulePrefix,
      options: optionsWithDefaults(options),
      activePackageRules: optionsWithDefaults(options).packageRules.map(rule => {
        return Object.assign({ roots: [appDir] }, rule);
      }),
      resolvableExtensions: ['.js', '.hbs'],
    });
    let compiler = new TemplateCompiler({ compilerPath, resolver, EmberENV, plugins });
    return function(relativePath: string, contents: string) {
      let moduleName = givenFile(relativePath);
      let { dependencies } = compiler.precompile(moduleName, contents);
      return sortBy(dependencies, d => d.runtimeName).map(d => ({
        path: d.path,
        runtimeName: d.runtimeName,
      }));
    };
  }

  throwOnWarnings();

  beforeEach(function() {
    assertWarning = function(pattern: RegExp, fn: () => void) {
      try {
        expect(expectWarning(pattern, fn)).toBeTruthy();
      } catch (err) {
        if (err.matcherResult) {
          err.message = `expected to get a warning matching ${pattern}`;
        }
        throw err;
      }
    };
  });

  afterEach(function() {
    if (appDir) {
      removeSync(appDir);
    }
  });

  function givenFile(filename: string) {
    let target = join(appDir, filename);
    ensureDirSync(dirname(target));
    writeFileSync(target, '');
    return target;
  }

  test('emits no components when staticComponents is off', function() {
    let findDependencies = configure({ staticComponents: false });
    givenFile('components/hello-world.js');
    expect(findDependencies('templates/application.hbs', `{{hello-world}} <HelloWorld />`)).toEqual([]);
  });

  test('bare dasherized component, js only', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/hello-world.js');
    expect(findDependencies('templates/application.hbs', `{{hello-world}}`)).toEqual([
      {
        path: '../components/hello-world.js',
        runtimeName: 'the-app/components/hello-world',
      },
    ]);
  });

  test('nested bare dasherized component, js only', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/something/hello-world.js');
    expect(findDependencies('templates/application.hbs', `{{something/hello-world}}`)).toEqual([
      {
        path: '../components/something/hello-world.js',
        runtimeName: 'the-app/components/something/hello-world',
      },
    ]);
  });

  describe('bare namespaced', function() {
    test('dasherized component, js only', function() {
      let findDependencies = configure({ staticComponents: true });
      givenFile('components/hello-world/index.js');
      expect(findDependencies('templates/application.hbs', `{{hello-world}}`)).toEqual([
        {
          path: '../components/hello-world/index.js',
          runtimeName: 'the-app/components/hello-world',
        },
      ]);
    });

    test('dasherized component, js and hbs', function() {
      let findDependencies = configure({ staticComponents: true });
      givenFile('components/hello-world/index.js');
      givenFile('components/hello-world/index.hbs');
      // the resolver only needs to handle the JS. Template-colocation causes
      // the JS to already import the HBS. That is also why we don't have a test
      // here for the hbs-only case -- from the resolver's perspective that case
      // doesn't exist, because we will have always synthesized the JS before
      // getting to the resolver.
      expect(findDependencies('templates/application.hbs', `{{hello-world}}`)).toEqual([
        {
          path: '../components/hello-world/index.js',
          runtimeName: 'the-app/components/hello-world',
        },
      ]);
    });
  });

  test('podded, dasherized component, with blank podModulePrefix, js only', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/hello-world/component.js');
    expect(findDependencies('templates/application.hbs', `{{hello-world}}`)).toEqual([
      {
        path: '../components/hello-world/component.js',
        runtimeName: 'the-app/components/hello-world/component',
      },
    ]);
  });

  test('podded, dasherized component, with blank podModulePrefix, hbs only', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/hello-world/template.hbs');
    expect(findDependencies('templates/application.hbs', `{{hello-world}}`)).toEqual([
      {
        path: '../components/hello-world/template.hbs',
        runtimeName: 'the-app/components/hello-world/template',
      },
    ]);
  });

  test('podded, dasherized component, with blank podModulePrefix, js and hbs', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/hello-world/component.js');
    givenFile('components/hello-world/template.hbs');
    expect(findDependencies('templates/application.hbs', `{{hello-world}}`)).toEqual([
      {
        path: '../components/hello-world/component.js',
        runtimeName: 'the-app/components/hello-world/component',
      },
      {
        path: '../components/hello-world/template.hbs',
        runtimeName: 'the-app/components/hello-world/template',
      },
    ]);
  });

  test('podded, dasherized component, with non-blank podModulePrefix, js only', function() {
    let findDependencies = configure({ staticComponents: true }, 'the-app/pods');
    givenFile('pods/components/hello-world/component.js');
    expect(findDependencies('templates/application.hbs', `{{hello-world}}`)).toEqual([
      {
        path: '../pods/components/hello-world/component.js',
        runtimeName: 'the-app/pods/components/hello-world/component',
      },
    ]);
  });

  test('podded, dasherized component, with non-blank podModulePrefix, hbs only', function() {
    let findDependencies = configure({ staticComponents: true }, 'the-app/pods');
    givenFile('pods/components/hello-world/template.hbs');
    expect(findDependencies('templates/application.hbs', `{{hello-world}}`)).toEqual([
      {
        path: '../pods/components/hello-world/template.hbs',
        runtimeName: 'the-app/pods/components/hello-world/template',
      },
    ]);
  });

  test('podded, dasherized component, with non-blank podModulePrefix, js and hbs', function() {
    let findDependencies = configure({ staticComponents: true }, 'the-app/pods');
    givenFile('pods/components/hello-world/component.js');
    givenFile('pods/components/hello-world/template.hbs');
    expect(findDependencies('templates/application.hbs', `{{hello-world}}`)).toEqual([
      {
        path: '../pods/components/hello-world/component.js',
        runtimeName: 'the-app/pods/components/hello-world/component',
      },
      {
        path: '../pods/components/hello-world/template.hbs',
        runtimeName: 'the-app/pods/components/hello-world/template',
      },
    ]);
  });

  test('bare dasherized component, hbs only', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('templates/components/hello-world.hbs');
    expect(findDependencies('templates/application.hbs', `{{hello-world}}`)).toEqual([
      {
        path: './components/hello-world.hbs',
        runtimeName: 'the-app/templates/components/hello-world',
      },
    ]);
  });
  test('bare dasherized component, js and hbs', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/hello-world.js');
    givenFile('templates/components/hello-world.hbs');
    expect(findDependencies('templates/application.hbs', `{{hello-world}}`)).toEqual([
      {
        path: '../components/hello-world.js',
        runtimeName: 'the-app/components/hello-world',
      },
      {
        path: './components/hello-world.hbs',
        runtimeName: 'the-app/templates/components/hello-world',
      },
    ]);
  });
  test('coalesces repeated components', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/hello-world.js');
    expect(findDependencies('templates/application.hbs', `{{hello-world}}{{hello-world}}`)).toEqual([
      {
        path: '../components/hello-world.js',
        runtimeName: 'the-app/components/hello-world',
      },
    ]);
  });

  test('tolerates non path mustaches', function() {
    let findDependencies = configure({ staticComponents: false, staticHelpers: true });
    expect(findDependencies('templates/application.hbs', `<Thing @foo={{1}} />`)).toEqual([]);
  });

  test('block form curly component', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/hello-world.js');
    expect(findDependencies('templates/application.hbs', `{{#hello-world}} {{/hello-world}}`)).toEqual([
      {
        path: '../components/hello-world.js',
        runtimeName: 'the-app/components/hello-world',
      },
    ]);
  });

  test('block form angle component', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/hello-world.js');
    expect(findDependencies('templates/application.hbs', `<HelloWorld></HelloWorld>`)).toEqual([
      {
        path: '../components/hello-world.js',
        runtimeName: 'the-app/components/hello-world',
      },
    ]);
  });

  test('curly contextual component', function() {
    let findDependencies = configure({ staticComponents: true, staticHelpers: true });
    givenFile('components/hello-world.js');
    expect(
      findDependencies(
        'templates/application.hbs',
        `{{#hello-world as |h|}} {{h.title flavor="chocolate"}} {{/hello-world}}`
      )
    ).toEqual([
      {
        path: '../components/hello-world.js',
        runtimeName: 'the-app/components/hello-world',
      },
    ]);
  });

  test('angle contextual component, upper', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/hello-world.js');
    expect(
      findDependencies('templates/application.hbs', `<HelloWorld as |H|> <H.title @flavor="chocolate" /> </HelloWorld>`)
    ).toEqual([
      {
        path: '../components/hello-world.js',
        runtimeName: 'the-app/components/hello-world',
      },
    ]);
  });

  test('angle contextual component, lower', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/hello-world.js');
    expect(
      findDependencies('templates/application.hbs', `<HelloWorld as |h|> <h.title @flavor="chocolate" /> </HelloWorld>`)
    ).toEqual([
      {
        path: '../components/hello-world.js',
        runtimeName: 'the-app/components/hello-world',
      },
    ]);
  });

  test('optional component missing in mustache', function() {
    let findDependencies = configure({
      staticComponents: true,
      staticHelpers: true,
      packageRules: [
        {
          package: 'the-test-package',
          components: {
            '{{this-one}}': { safeToIgnore: true },
          },
        },
      ],
    });
    expect(findDependencies('templates/application.hbs', `{{this-one x=true}}`)).toEqual([]);
  });
  test('optional component missing in mustache block', function() {
    let findDependencies = configure({
      staticComponents: true,
      staticHelpers: true,
      packageRules: [
        {
          package: 'the-test-package',
          components: {
            '{{this-one}}': { safeToIgnore: true },
          },
        },
      ],
    });
    expect(findDependencies('templates/application.hbs', `{{#this-one}} {{/this-one}}`)).toEqual([]);
  });
  test('optional component missing in mustache', function() {
    let findDependencies = configure({
      staticComponents: true,
      staticHelpers: true,
      packageRules: [
        {
          package: 'the-test-package',
          components: {
            '{{this-one}}': { safeToIgnore: true },
          },
        },
      ],
    });
    expect(findDependencies('templates/application.hbs', `{{this-one x=true}}`)).toEqual([]);
  });
  test('optional component declared as element missing in mustache block', function() {
    let findDependencies = configure({
      staticComponents: true,
      staticHelpers: true,
      packageRules: [
        {
          package: 'the-test-package',
          components: {
            '<ThisOne />': { safeToIgnore: true },
          },
        },
      ],
    });
    expect(findDependencies('templates/application.hbs', `{{#this-one}} {{/this-one}}`)).toEqual([]);
  });
  test('optional component missing in element', function() {
    let findDependencies = configure({
      staticComponents: true,
      staticHelpers: true,
      packageRules: [
        {
          package: 'the-test-package',
          components: {
            '{{this-one}}': { safeToIgnore: true },
          },
        },
      ],
    });
    expect(findDependencies('templates/application.hbs', `<ThisOne/>`)).toEqual([]);
  });
  test('mustache missing, no args', function() {
    let findDependencies = configure({
      staticComponents: true,
      staticHelpers: true,
    });
    expect(findDependencies('templates/application.hbs', `{{hello-world}}`)).toEqual([]);
  });
  test('mustache missing, with args', function() {
    let findDependencies = configure({
      staticComponents: true,
      staticHelpers: true,
    });
    expect(() => {
      findDependencies('templates/application.hbs', `{{hello-world foo=bar}}`);
    }).toThrow(new RegExp(`Missing component or helper hello-world in ${appDir}/templates/application.hbs`));
  });
  test('string literal passed to component helper in content position', function() {
    let findDependencies = configure({
      staticComponents: true,
    });
    givenFile('components/hello-world.js');
    expect(findDependencies('templates/application.hbs', `{{component "hello-world"}}`)).toEqual([
      {
        path: '../components/hello-world.js',
        runtimeName: 'the-app/components/hello-world',
      },
    ]);
  });
  test('string literal passed to component helper with block', function() {
    let findDependencies = configure({
      staticComponents: true,
    });
    givenFile('components/hello-world.js');
    expect(findDependencies('templates/application.hbs', `{{#component "hello-world"}} {{/component}}`)).toEqual([
      {
        path: '../components/hello-world.js',
        runtimeName: 'the-app/components/hello-world',
      },
    ]);
  });
  test('string literal passed to component helper in helper position', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/hello-world.js');
    givenFile('components/my-thing.js');
    expect(findDependencies('templates/application.hbs', `{{my-thing header=(component "hello-world") }}`)).toEqual([
      {
        path: '../components/hello-world.js',
        runtimeName: 'the-app/components/hello-world',
      },
      {
        path: '../components/my-thing.js',
        runtimeName: 'the-app/components/my-thing',
      },
    ]);
  });
  test('string literal passed to component helper fails to resolve', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/my-thing.js');
    expect(() => {
      findDependencies('templates/application.hbs', `{{my-thing header=(component "hello-world") }}`);
    }).toThrow(new RegExp(`Missing component hello-world in templates/application.hbs`));
  });
  test('string literal passed to component helper fails to resolve when staticComponents is off', function() {
    let findDependencies = configure({ staticComponents: false });
    givenFile('components/my-thing.js');
    expect(findDependencies('templates/application.hbs', `{{my-thing header=(component "hello-world") }}`)).toEqual([]);
  });
  test('dynamic component helper warning in content position', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/hello-world.js');
    assertWarning(/ignoring dynamic component this\.which/, () => {
      findDependencies('templates/application.hbs', `{{component this.which}}`);
    });
  });
  test('angle component, js and hbs', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/hello-world.js');
    givenFile('templates/components/hello-world.hbs');
    expect(findDependencies('templates/application.hbs', `<HelloWorld />`)).toEqual([
      {
        path: '../components/hello-world.js',
        runtimeName: 'the-app/components/hello-world',
      },
      {
        path: './components/hello-world.hbs',
        runtimeName: 'the-app/templates/components/hello-world',
      },
    ]);
  });
  test('nested angle component, js and hbs', function() {
    let findDependencies = configure({ staticComponents: true });
    givenFile('components/something/hello-world.js');
    givenFile('templates/components/something/hello-world.hbs');
    expect(findDependencies('templates/application.hbs', `<Something::HelloWorld />`)).toEqual([
      {
        path: '../components/something/hello-world.js',
        runtimeName: 'the-app/components/something/hello-world',
      },
      {
        path: './components/something/hello-world.hbs',
        runtimeName: 'the-app/templates/components/something/hello-world',
      },
    ]);
  });
  test('angle component missing', function() {
    let findDependencies = configure({ staticComponents: true });
    expect(() => {
      findDependencies('templates/application.hbs', `<HelloWorld />`);
    }).toThrow(new RegExp(`Missing component HelloWorld in ${appDir}/templates/application.hbs`));
  });
  test('helper in subexpression', function() {
    let findDependencies = configure({ staticHelpers: true });
    givenFile('helpers/array.js');
    expect(findDependencies('templates/application.hbs', `{{#each (array 1 2 3) as |num|}} {{num}} {{/each}}`)).toEqual(
      [
        {
          runtimeName: 'the-app/helpers/array',
          path: '../helpers/array.js',
        },
      ]
    );
  });
  test('missing subexpression with args', function() {
    let findDependencies = configure({ staticHelpers: true });
    expect(() => {
      findDependencies('templates/application.hbs', `{{#each (things 1 2 3) as |num|}} {{num}} {{/each}}`);
    }).toThrow(new RegExp(`Missing helper things in ${appDir}/templates/application.hbs`));
  });
  test('missing subexpression no args', function() {
    let findDependencies = configure({ staticHelpers: true });
    expect(() => {
      findDependencies('templates/application.hbs', `{{#each (things) as |num|}} {{num}} {{/each}}`);
    }).toThrow(new RegExp(`Missing helper things in ${appDir}/templates/application.hbs`));
  });
  test('emits no helpers when staticHelpers is off', function() {
    let findDependencies = configure({ staticHelpers: false });
    givenFile('helpers/array.js');
    expect(findDependencies('templates/application.hbs', `{{#each (array 1 2 3) as |num|}} {{num}} {{/each}}`)).toEqual(
      []
    );
  });
  test('helper as component argument', function() {
    let findDependencies = configure({ staticHelpers: true });
    givenFile('helpers/array.js');
    expect(findDependencies('templates/application.hbs', `{{my-component value=(array 1 2 3) }}`)).toEqual([
      {
        runtimeName: 'the-app/helpers/array',
        path: '../helpers/array.js',
      },
    ]);
  });
  test('helper as html attribute', function() {
    let findDependencies = configure({ staticHelpers: true });
    givenFile('helpers/capitalize.js');
    expect(findDependencies('templates/application.hbs', `<div data-foo={{capitalize name}}></div>`)).toEqual([
      {
        runtimeName: 'the-app/helpers/capitalize',
        path: '../helpers/capitalize.js',
      },
    ]);
  });
  test('helper in bare mustache, no args', function() {
    let findDependencies = configure({ staticHelpers: true });
    givenFile('helpers/capitalize.js');
    expect(findDependencies('templates/application.hbs', `{{capitalize}}`)).toEqual([
      {
        runtimeName: 'the-app/helpers/capitalize',
        path: '../helpers/capitalize.js',
      },
    ]);
  });
  test('helper in bare mustache, with args', function() {
    let findDependencies = configure({ staticHelpers: true });
    givenFile('helpers/capitalize.js');
    expect(findDependencies('templates/application.hbs', `{{capitalize name}}`)).toEqual([
      {
        runtimeName: 'the-app/helpers/capitalize',
        path: '../helpers/capitalize.js',
      },
    ]);
  });
  test('local binding takes precedence over helper in bare mustache', function() {
    let findDependencies = configure({ staticHelpers: true });
    givenFile('helpers/capitalize.js');
    expect(
      findDependencies('templates/application.hbs', `{{#each things as |capitalize|}} {{capitalize}} {{/each}}`)
    ).toEqual([]);
  });
  test('local binding takes precedence over component in element position', function() {
    let findDependencies = configure({ staticHelpers: true });
    givenFile('components/the-thing.js');
    expect(
      findDependencies('templates/application.hbs', `{{#each things as |TheThing|}} <TheThing /> {{/each}}`)
    ).toEqual([]);
  });
  test('angle components can establish local bindings', function() {
    let findDependencies = configure({ staticHelpers: true });
    givenFile('helpers/capitalize.js');
    expect(findDependencies('templates/application.hbs', `<Outer as |capitalize|> {{capitalize}} </Outer>`)).toEqual(
      []
    );
  });
  test('local binding only applies within block', function() {
    let findDependencies = configure({ staticHelpers: true });
    givenFile('helpers/capitalize.js');
    expect(
      findDependencies(
        'templates/application.hbs',
        `{{#each things as |capitalize|}} {{capitalize}} {{/each}} {{capitalize}}`
      )
    ).toEqual([
      {
        runtimeName: 'the-app/helpers/capitalize',
        path: '../helpers/capitalize.js',
      },
    ]);
  });
  test('ignores builtins', function() {
    let findDependencies = configure({ staticHelpers: true, staticComponents: true });
    expect(
      findDependencies(
        'templates/application.hbs',
        `
        {{outlet "foo"}}
        {{yield bar}}
        {{#with (hash submit=(action doit)) as |thing| }}
        {{/with}}
        <LinkTo @route="index"/>
      `
      )
    ).toEqual([]);
  });
  test('ignores dot-rule curly component invocation, inline', function() {
    let findDependencies = configure({ staticHelpers: true, staticComponents: true });
    expect(
      findDependencies(
        'templates/application.hbs',
        `
        {{thing.body x=1}}
        `
      )
    ).toEqual([]);
  });
  test('ignores dot-rule curly component invocation, block', function() {
    let findDependencies = configure({ staticHelpers: true, staticComponents: true });
    expect(
      findDependencies(
        'templates/application.hbs',
        `
        {{#thing.body}}
        {{/thing.body}}
        `
      )
    ).toEqual([]);
  });

  test('respects yieldsSafeComponents rule, position 0', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            yieldsSafeComponents: [true],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    findDependencies(
      'templates/application.hbs',
      `
      {{#form-builder as |field| }}
        {{component field}}
      {{/form-builder}}
    `
    );
  });

  test('respects yieldsSafeComponents rule on element, position 0', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            yieldsSafeComponents: [true],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    findDependencies(
      'templates/application.hbs',
      `
      <FormBuilder as |field| >
        {{component field}}
      </FormBuilder>
    `
    );
  });

  test('respects yieldsSafeComponents rule, position 1', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            yieldsSafeComponents: [false, true],
          },
        },
      },
    ];
    let findDependencies = configure({
      staticComponents: true,
      packageRules,
    });
    givenFile('templates/components/form-builder.hbs');
    findDependencies(
      'templates/application.hbs',
      `
      {{#form-builder as |other field| }}
        {{component field}}
      {{/form-builder}}
    `
    );
    assertWarning(/ignoring dynamic component other/, () => {
      findDependencies(
        'templates/application.hbs',
        `
        {{#form-builder as |other field| }}
          {{component other}}
        {{/form-builder}}
      `
      );
    });
  });

  test('respects yieldsSafeComponents rule, position 0.field', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            yieldsSafeComponents: [
              {
                field: true,
              },
            ],
          },
        },
      },
    ];
    let findDependencies = configure({
      staticComponents: true,
      packageRules,
    });
    givenFile('templates/components/form-builder.hbs');
    findDependencies(
      'templates/application.hbs',
      `
      {{#form-builder as |f| }}
        {{component f.field}}
      {{/form-builder}}
    `
    );
    assertWarning(/ignoring dynamic component f.other/, () => {
      findDependencies(
        'templates/application.hbs',
        `
        {{#form-builder as |f| }}
          {{component f.other}}
        {{/form-builder}}
      `
      );
    });
  });

  test('respects yieldsSafeComponents rule, position 1.field', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            yieldsSafeComponents: [
              false,
              {
                field: true,
              },
            ],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    findDependencies(
      'templates/application.hbs',
      `
      {{#form-builder as |x f| }}
        {{component f.field}}
      {{/form-builder}}
    `
    );
    assertWarning(/ignoring dynamic component f.other/, () => {
      findDependencies(
        'templates/application.hbs',
        `
        {{#form-builder as |x f| }}
          {{component f.other}}
        {{/form-builder}}
    `
      );
    });
  });

  test('acceptsComponentArguments on mustache with valid literal', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            acceptsComponentArguments: ['title'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    givenFile('templates/components/fancy-title.hbs');
    expect(findDependencies('templates/application.hbs', `{{form-builder title="fancy-title"}}`)).toEqual([
      {
        runtimeName: 'the-app/templates/components/fancy-title',
        path: './components/fancy-title.hbs',
      },
      {
        runtimeName: 'the-app/templates/components/form-builder',
        path: './components/form-builder.hbs',
      },
    ]);
  });

  test('acceptsComponentArguments on mustache block with valid literal', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            acceptsComponentArguments: ['title'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    givenFile('templates/components/fancy-title.hbs');
    expect(
      findDependencies('templates/application.hbs', `{{#form-builder title="fancy-title"}} {{/form-builder}}`)
    ).toEqual([
      {
        runtimeName: 'the-app/templates/components/fancy-title',
        path: './components/fancy-title.hbs',
      },
      {
        runtimeName: 'the-app/templates/components/form-builder',
        path: './components/form-builder.hbs',
      },
    ]);
  });

  test('acceptsComponentArguments argument name may include optional @', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            acceptsComponentArguments: ['@title'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    givenFile('templates/components/fancy-title.hbs');
    expect(findDependencies('templates/application.hbs', `{{form-builder title="fancy-title"}}`)).toEqual([
      {
        runtimeName: 'the-app/templates/components/fancy-title',
        path: './components/fancy-title.hbs',
      },
      {
        runtimeName: 'the-app/templates/components/form-builder',
        path: './components/form-builder.hbs',
      },
    ]);
  });

  test('acceptsComponentArguments on mustache with component subexpression', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            acceptsComponentArguments: ['title'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    givenFile('templates/components/fancy-title.hbs');
    expect(findDependencies('templates/application.hbs', `{{form-builder title=(component "fancy-title") }}`)).toEqual([
      {
        runtimeName: 'the-app/templates/components/fancy-title',
        path: './components/fancy-title.hbs',
      },
      {
        runtimeName: 'the-app/templates/components/form-builder',
        path: './components/form-builder.hbs',
      },
    ]);
  });

  test('acceptsComponentArguments on element with component helper mustache', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            acceptsComponentArguments: ['title'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    givenFile('templates/components/fancy-title.hbs');
    expect(findDependencies('templates/application.hbs', `<FormBuilder @title={{component "fancy-title"}} />`)).toEqual(
      [
        {
          runtimeName: 'the-app/templates/components/fancy-title',
          path: './components/fancy-title.hbs',
        },
        {
          runtimeName: 'the-app/templates/components/form-builder',
          path: './components/form-builder.hbs',
        },
      ]
    );
  });

  test(`element block params are not in scope for element's own attributes`, function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            acceptsComponentArguments: ['title'],
            yieldsSafeComponents: [true],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    assertWarning(/ignoring dynamic component title/, () => {
      expect(
        findDependencies('templates/application.hbs', `<FormBuilder @title={{title}} as |title|></FormBuilder>`)
      ).toEqual([
        {
          runtimeName: 'the-app/templates/components/form-builder',
          path: './components/form-builder.hbs',
        },
      ]);
    });
  });

  test('acceptsComponentArguments on mustache with invalid literal', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            acceptsComponentArguments: ['title'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    expect(() => {
      findDependencies('templates/application.hbs', `{{form-builder title="fancy-title"}}`);
    }).toThrow(/Missing component fancy-title in templates\/application\.hbs/);
  });

  test('acceptsComponentArguments on element with valid literal', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            acceptsComponentArguments: ['title'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    givenFile('templates/components/fancy-title.hbs');
    expect(findDependencies('templates/application.hbs', `<FormBuilder @title={{"fancy-title"}} />`)).toEqual([
      {
        runtimeName: 'the-app/templates/components/fancy-title',
        path: './components/fancy-title.hbs',
      },
      {
        runtimeName: 'the-app/templates/components/form-builder',
        path: './components/form-builder.hbs',
      },
    ]);
  });

  test('acceptsComponentArguments on element with valid attribute', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            acceptsComponentArguments: ['title'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    givenFile('templates/components/fancy-title.hbs');
    expect(findDependencies('templates/application.hbs', `<FormBuilder @title="fancy-title" />`)).toEqual([
      {
        runtimeName: 'the-app/templates/components/fancy-title',
        path: './components/fancy-title.hbs',
      },
      {
        runtimeName: 'the-app/templates/components/form-builder',
        path: './components/form-builder.hbs',
      },
    ]);
  });

  test('acceptsComponentArguments interior usage of path generates no warning', function() {
    let packageRules = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            acceptsComponentArguments: ['title'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    expect(findDependencies('templates/components/form-builder.hbs', `{{component title}}`)).toEqual([]);
  });

  test('acceptsComponentArguments interior usage of this.path generates no warning', function() {
    let packageRules: PackageRules[] = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            acceptsComponentArguments: [
              {
                name: 'title',
                becomes: 'this.title',
              },
            ],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    expect(findDependencies('templates/components/form-builder.hbs', `{{component this.title}}`)).toEqual([]);
  });

  test('acceptsComponentArguments interior usage of @path generates no warning', function() {
    let packageRules: PackageRules[] = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            acceptsComponentArguments: ['@title'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    expect(findDependencies('templates/components/form-builder.hbs', `{{component @title}}`)).toEqual([]);
  });

  test('safeToIgnore a missing component', function() {
    let packageRules: PackageRules[] = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            safeToIgnore: true,
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    expect(findDependencies('templates/components/x.hbs', `<FormBuilder />`)).toEqual([]);
  });

  test('safeToIgnore a present component', function() {
    let packageRules: PackageRules[] = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            safeToIgnore: true,
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    expect(findDependencies('templates/components/x.hbs', `<FormBuilder />`)).toEqual([
      {
        path: './form-builder.hbs',
        runtimeName: 'the-app/templates/components/form-builder',
      },
    ]);
  });

  test('respects yieldsArguments rule for positional block param, angle', function() {
    let packageRules: PackageRules[] = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            yieldsArguments: ['navbar'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    givenFile('templates/components/fancy-navbar.hbs');
    expect(
      findDependencies(
        'templates/components/x.hbs',
        `
        <FormBuilder @navbar={{component "fancy-navbar"}} as |bar|>
          {{component bar}}
        </FormBuilder>
        `
      )
    ).toEqual([
      {
        path: './fancy-navbar.hbs',
        runtimeName: 'the-app/templates/components/fancy-navbar',
      },
      {
        path: './form-builder.hbs',
        runtimeName: 'the-app/templates/components/form-builder',
      },
    ]);
  });

  test('respects yieldsArguments rule for positional block param, curly', function() {
    let packageRules: PackageRules[] = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            yieldsArguments: ['navbar'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    givenFile('templates/components/fancy-navbar.hbs');
    expect(
      findDependencies(
        'templates/components/x.hbs',
        `
        {{#form-builder navbar=(component "fancy-navbar") as |bar|}}
          {{component bar}}
        {{/form-builder}}
        `
      )
    ).toEqual([
      {
        path: './fancy-navbar.hbs',
        runtimeName: 'the-app/templates/components/fancy-navbar',
      },
      {
        path: './form-builder.hbs',
        runtimeName: 'the-app/templates/components/form-builder',
      },
    ]);
  });

  test('respects yieldsArguments rule for hash block param', function() {
    let packageRules: PackageRules[] = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            yieldsArguments: [
              {
                bar: 'navbar',
              },
            ],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    givenFile('templates/components/fancy-navbar.hbs');
    expect(
      findDependencies(
        'templates/components/x.hbs',
        `
        <FormBuilder @navbar={{component "fancy-navbar"}} as |f|>
          {{component f.bar}}
        </FormBuilder>
        `
      )
    ).toEqual([
      {
        path: './fancy-navbar.hbs',
        runtimeName: 'the-app/templates/components/fancy-navbar',
      },
      {
        path: './form-builder.hbs',
        runtimeName: 'the-app/templates/components/form-builder',
      },
    ]);
  });

  test('yieldsArguments causes warning to propagate up lexically, angle', function() {
    let packageRules: PackageRules[] = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            yieldsArguments: ['navbar'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    assertWarning(/ignoring dynamic component this\.unknown/, () => {
      expect(
        findDependencies(
          'templates/components/x.hbs',
          `
          <FormBuilder @navbar={{this.unknown}} as |bar|>
            {{component bar}}
          </FormBuilder>
          `
        )
      ).toEqual([
        {
          path: './form-builder.hbs',
          runtimeName: 'the-app/templates/components/form-builder',
        },
      ]);
    });
  });

  test('yieldsArguments causes warning to propagate up lexically, curl', function() {
    let packageRules: PackageRules[] = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            yieldsArguments: ['navbar'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    assertWarning(/ignoring dynamic component this\.unknown/, () => {
      expect(
        findDependencies(
          'templates/components/x.hbs',
          `
          {{#form-builder navbar=this.unknown as |bar|}}
            {{component bar}}
          {{/form-builder}}
          `
        )
      ).toEqual([
        {
          path: './form-builder.hbs',
          runtimeName: 'the-app/templates/components/form-builder',
        },
      ]);
    });
  });

  test('yieldsArguments causes warning to propagate up lexically, multiple levels', function() {
    let packageRules: PackageRules[] = [
      {
        package: 'the-test-package',
        components: {
          '<FormBuilder />': {
            yieldsArguments: ['navbar'],
          },
        },
      },
    ];
    let findDependencies = configure({ staticComponents: true, packageRules });
    givenFile('templates/components/form-builder.hbs');
    assertWarning(/ignoring dynamic component this\.unknown/, () => {
      expect(
        findDependencies(
          'templates/components/x.hbs',
          `
          {{#form-builder navbar=this.unknown as |bar1|}}
            {{#form-builder navbar=bar1 as |bar2|}}
              {{component bar2}}
            {{/form-builder}}
          {{/form-builder}}
          `
        )
      ).toEqual([
        {
          path: './form-builder.hbs',
          runtimeName: 'the-app/templates/components/form-builder',
        },
      ]);
    });
  });
});
