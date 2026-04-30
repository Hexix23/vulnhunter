# C39 Singleton-Race Walkthrough

## Phase 1 static analysis

### 1a. `targets/angular-cli/packages/angular/ssr/src/app.ts`

```text
     1	/**
     2	 * @license
     3	 * Copyright Google LLC All Rights Reserved.
     4	 *
     5	 * Use of this source code is governed by an MIT-style license that can be
     6	 * found in the LICENSE file at https://angular.dev/license
     7	 */
     8	
     9	import {
    10	  LOCALE_ID,
    11	  REQUEST,
    12	  REQUEST_CONTEXT,
    13	  RESPONSE_INIT,
    14	  StaticProvider,
    15	  ɵresetCompiledComponents,
    16	} from '@angular/core';
    17	import { ServerAssets } from './assets';
    18	import { Hooks } from './hooks';
    19	import { getAngularAppManifest } from './manifest';
    20	import { RenderMode } from './routes/route-config';
    21	import { RouteTreeNodeMetadata } from './routes/route-tree';
    22	import { ServerRouter } from './routes/router';
    23	import { sha256 } from './utils/crypto';
    24	import { InlineCriticalCssProcessor } from './utils/inline-critical-css';
    25	import { LRUCache } from './utils/lru-cache';
    26	import { AngularBootstrap, renderAngular } from './utils/ng';
    27	import { promiseWithAbort } from './utils/promise';
    28	import { createRedirectResponse } from './utils/redirect';
    29	import { buildPathWithParams, joinUrlParts, stripLeadingSlash } from './utils/url';
    30	
    31	/**
    32	 * A set of well-known URLs that are not handled by Angular.
    33	 *
    34	 * These URLs are typically for static assets or endpoints that should
    35	 * bypass the Angular routing and rendering process.
    36	 */
    37	const WELL_KNOWN_NON_ANGULAR_URLS: ReadonlySet<string> = new Set<string>([
    38	  '/favicon.ico',
    39	  '/.well-known/appspecific/com.chrome.devtools.json',
    40	]);
    41	
    42	/**
    43	 * Maximum number of critical CSS entries the cache can store.
    44	 * This value determines the capacity of the LRU (Least Recently Used) cache, which stores critical CSS for pages.
    45	 */
    46	const MAX_INLINE_CSS_CACHE_ENTRIES = 50;
    47	
    48	/**
    49	 * A mapping of `RenderMode` enum values to corresponding string representations.
    50	 *
    51	 * This record is used to map each `RenderMode` to a specific string value that represents
    52	 * the server context. The string values are used internally to differentiate
    53	 * between various rendering strategies when processing routes.
    54	 *
    55	 * - `RenderMode.Prerender` maps to `'ssg'` (Static Site Generation).
    56	 * - `RenderMode.Server` maps to `'ssr'` (Server-Side Rendering).
    57	 * - `RenderMode.Client` maps to an empty string `''` (Client-Side Rendering, no server context needed).
    58	 */
    59	const SERVER_CONTEXT_VALUE: Record<RenderMode, string> = {
    60	  [RenderMode.Prerender]: 'ssg',
    61	  [RenderMode.Server]: 'ssr',
    62	  [RenderMode.Client]: '',
    63	};
    64	
    65	/**
    66	 * Options for configuring an `AngularServerApp`.
    67	 */
    68	interface AngularServerAppOptions {
    69	  /**
    70	   * Whether to allow rendering of prerendered routes.
    71	   *
    72	   * When enabled, prerendered routes will be served directly. When disabled, they will be
    73	   * rendered on demand.
    74	   *
    75	   * Defaults to `false`.
    76	   */
    77	  allowStaticRouteRender?: boolean;
    78	
    79	  /**
    80	   *  Hooks for extending or modifying server behavior.
    81	   *
    82	   * This allows customization of the server's rendering process and other lifecycle events.
    83	   *
    84	   * If not provided, a new `Hooks` instance is created.
    85	   */
    86	  hooks?: Hooks;
    87	}
    88	
    89	/**
    90	 * Represents a locale-specific Angular server application managed by the server application engine.
    91	 *
    92	 * The `AngularServerApp` class handles server-side rendering and asset management for a specific locale.
    93	 */
    94	export class AngularServerApp {
    95	  /**
    96	   * Whether prerendered routes should be rendered on demand or served directly.
    97	   *
    98	   * @see {@link AngularServerAppOptions.allowStaticRouteRender} for more details.
    99	   */
   100	  private readonly allowStaticRouteRender: boolean;
   101	
   102	  /**
   103	   * Hooks for extending or modifying server behavior.
   104	   *
   105	   * @see {@link AngularServerAppOptions.hooks} for more details.
   106	   */
   107	  readonly hooks: Hooks;
   108	
   109	  /**
   110	   * Constructs an instance of `AngularServerApp`.
   111	   *
   112	   * @param options Optional configuration options for the server application.
   113	   */
   114	  constructor(private readonly options: Readonly<AngularServerAppOptions> = {}) {
   115	    this.allowStaticRouteRender = this.options.allowStaticRouteRender ?? false;
   116	    this.hooks = options.hooks ?? new Hooks();
   117	
   118	    if (this.manifest.inlineCriticalCss) {
   119	      this.inlineCriticalCssProcessor = new InlineCriticalCssProcessor((path: string) => {
   120	        const fileName = path.split('/').pop() ?? path;
   121	
   122	        return this.assets.getServerAsset(fileName).text();
   123	      });
   124	    }
   125	  }
   126	
   127	  /**
   128	   * The manifest associated with this server application.
   129	   */
   130	  private readonly manifest = getAngularAppManifest();
   131	
   132	  /**
   133	   * An instance of ServerAsset that handles server-side asset.
   134	   */
   135	  private readonly assets = new ServerAssets(this.manifest);
   136	
   137	  /**
   138	   * The router instance used for route matching and handling.
   139	   */
   140	  private router: ServerRouter | undefined;
   141	
   142	  /**
   143	   * The `inlineCriticalCssProcessor` is responsible for handling critical CSS inlining.
   144	   */
   145	  private inlineCriticalCssProcessor: InlineCriticalCssProcessor | undefined;
   146	
   147	  /**
   148	   * The bootstrap mechanism for the server application.
   149	   */
   150	  private boostrap: AngularBootstrap | undefined;
   151	
   152	  /**
   153	   * Decorder used to convert a string to a Uint8Array.
   154	   */
   155	  private readonly textDecoder = new TextEncoder();
   156	
   157	  /**
   158	   * A cache that stores critical CSS to avoid re-processing for every request, improving performance.
   159	   * This cache uses a Least Recently Used (LRU) eviction policy.
   160	   *
   161	   * @see {@link MAX_INLINE_CSS_CACHE_ENTRIES} for the maximum number of entries this cache can hold.
   162	   */
   163	  private readonly criticalCssLRUCache = new LRUCache<
   164	    string,
   165	    { shaOfContentPreInlinedCss: string; contentWithCriticialCSS: Uint8Array<ArrayBufferLike> }
   166	  >(MAX_INLINE_CSS_CACHE_ENTRIES);
   167	
   168	  /**
   169	   * Handles an incoming HTTP request by serving prerendered content, performing server-side rendering,
   170	   * or delivering a static file for client-side rendered routes based on the `RenderMode` setting.
   171	   *
   172	   * @param request - The HTTP request to handle.
   173	   * @param requestContext - Optional context for rendering, such as metadata associated with the request.
   174	   * @returns A promise that resolves to the resulting HTTP response object, or `null` if no matching Angular route is found.
   175	   *
   176	   * @remarks A request to `https://www.example.com/page/index.html` will serve or render the Angular route
   177	   * corresponding to `https://www.example.com/page`.
   178	   */
   179	  async handle(request: Request, requestContext?: unknown): Promise<Response | null> {
   180	    const url = new URL(request.url);
   181	    if (WELL_KNOWN_NON_ANGULAR_URLS.has(url.pathname)) {
   182	      return null;
   183	    }
   184	
   185	    this.router ??= await ServerRouter.from(this.manifest, url);
   186	    const matchedRoute = this.router.match(url);
   187	
   188	    if (!matchedRoute) {
   189	      // Not a known Angular route.
   190	      return null;
   191	    }
   192	
   193	    const { redirectTo, status, renderMode, headers } = matchedRoute;
   194	
   195	    if (redirectTo !== undefined) {
   196	      return createRedirectResponse(
   197	        joinUrlParts(
   198	          request.headers.get('X-Forwarded-Prefix') ?? '',
   199	          buildPathWithParams(redirectTo, url.pathname),
   200	        ),
   201	        status,
   202	        headers,
   203	      );
   204	    }
   205	
   206	    if (renderMode === RenderMode.Prerender) {
   207	      const response = await this.handleServe(request, matchedRoute);
   208	      if (response) {
   209	        return response;
   210	      }
   211	    }
   212	
   213	    return promiseWithAbort(
   214	      this.handleRendering(request, matchedRoute, requestContext),
   215	      request.signal,
   216	      `Request for: ${request.url}`,
   217	    );
   218	  }
   219	
   220	  /**
   221	   * Handles serving a prerendered static asset if available for the matched route.
   222	   *
   223	   * This method only supports `GET` and `HEAD` requests.
   224	   *
   225	   * @param request - The incoming HTTP request for serving a static page.
   226	   * @param matchedRoute - The metadata of the matched route for rendering.
   227	   * @returns A promise that resolves to a `Response` object if the prerendered page is found, or `null`.
   228	   */
   229	  private async handleServe(
   230	    request: Request,
   231	    matchedRoute: RouteTreeNodeMetadata,
   232	  ): Promise<Response | null> {
   233	    const { headers, renderMode } = matchedRoute;
   234	    if (renderMode !== RenderMode.Prerender) {
   235	      return null;
   236	    }
   237	
   238	    const { method } = request;
   239	    if (method !== 'GET' && method !== 'HEAD') {
   240	      return null;
   241	    }
   242	
   243	    const assetPath = this.buildServerAssetPathFromRequest(request);
   244	    const {
   245	      manifest: { locale },
   246	      assets,
   247	    } = this;
   248	
   249	    if (!assets.hasServerAsset(assetPath)) {
   250	      return null;
   251	    }
   252	
   253	    const { text, hash, size } = assets.getServerAsset(assetPath);
   254	    const etag = `"${hash}"`;
   255	
   256	    return request.headers.get('if-none-match') === etag
   257	      ? new Response(undefined, { status: 304, statusText: 'Not Modified' })
   258	      : new Response(await text(), {
   259	          headers: {
   260	            'Content-Length': size.toString(),
   261	            'ETag': etag,
   262	            'Content-Type': 'text/html;charset=UTF-8',
   263	            ...(locale !== undefined ? { 'Content-Language': locale } : {}),
   264	            ...headers,
   265	          },
   266	        });
   267	  }
   268	
   269	  /**
   270	   * Handles the server-side rendering process for the given HTTP request.
   271	   * This method matches the request URL to a route and performs rendering if a matching route is found.
   272	   *
   273	   * @param request - The incoming HTTP request to be processed.
   274	   * @param matchedRoute - The metadata of the matched route for rendering.
   275	   * @param requestContext - Optional additional context for rendering, such as request metadata.
   276	   *
   277	   * @returns A promise that resolves to the rendered response, or null if no matching route is found.
   278	   */
   279	  private async handleRendering(
   280	    request: Request,
   281	    matchedRoute: RouteTreeNodeMetadata,
   282	    requestContext?: unknown,
   283	  ): Promise<Response | null> {
   284	    const { renderMode, headers, status, preload } = matchedRoute;
   285	
   286	    if (!this.allowStaticRouteRender && renderMode === RenderMode.Prerender) {
   287	      return null;
   288	    }
   289	
   290	    const url = new URL(request.url);
   291	    const platformProviders: StaticProvider[] = [];
   292	
   293	    const {
   294	      manifest: { bootstrap, locale },
   295	      assets,
   296	    } = this;
   297	
   298	    // Initialize the response with status and headers if available.
   299	    const responseInit = {
   300	      status,
   301	      headers: new Headers({
   302	        'Content-Type': 'text/html;charset=UTF-8',
   303	        ...(locale !== undefined ? { 'Content-Language': locale } : {}),
   304	        ...headers,
   305	      }),
   306	    };
   307	
   308	    if (renderMode === RenderMode.Server) {
   309	      // Configure platform providers for request and response only for SSR.
   310	      platformProviders.push(
   311	        {
   312	          provide: REQUEST,
   313	          useValue: request,
   314	        },
   315	        {
   316	          provide: REQUEST_CONTEXT,
   317	          useValue: requestContext,
   318	        },
   319	        {
   320	          provide: RESPONSE_INIT,
   321	          useValue: responseInit,
   322	        },
   323	      );
   324	    } else if (renderMode === RenderMode.Client) {
   325	      // Serve the client-side rendered version if the route is configured for CSR.
   326	      let html = await this.assets.getServerAsset('index.csr.html').text();
   327	      html = await this.runTransformsOnHtml(html, url, preload);
   328	
   329	      return new Response(html, responseInit);
   330	    }
   331	
   332	    if (locale !== undefined) {
   333	      platformProviders.push({
   334	        provide: LOCALE_ID,
   335	        useValue: locale,
   336	      });
   337	    }
   338	
   339	    this.boostrap ??= await bootstrap();
   340	    let html = await assets.getIndexServerHtml().text();
   341	    html = await this.runTransformsOnHtml(html, url, preload);
   342	
   343	    const result = await renderAngular(
   344	      html,
   345	      this.boostrap,
   346	      url,
   347	      platformProviders,
   348	      SERVER_CONTEXT_VALUE[renderMode],
   349	    );
   350	
   351	    if (result.hasNavigationError) {
   352	      return null;
   353	    }
   354	
   355	    if (result.redirectTo) {
   356	      return createRedirectResponse(result.redirectTo, responseInit.status, headers);
   357	    }
   358	
   359	    if (renderMode === RenderMode.Prerender) {
   360	      const renderedHtml = await result.content();
   361	      const finalHtml = await this.inlineCriticalCss(renderedHtml, url);
   362	
   363	      return new Response(finalHtml, responseInit);
   364	    }
   365	
   366	    // Use a stream to send the response before finishing rendering and inling critical CSS, improving performance via header flushing.
   367	    const stream = new ReadableStream({
   368	      start: async (controller) => {
   369	        const renderedHtml = await result.content();
   370	        const finalHtml = await this.inlineCriticalCssWithCache(renderedHtml, url);
   371	        controller.enqueue(finalHtml);
   372	        controller.close();
   373	      },
   374	    });
   375	
   376	    return new Response(stream, responseInit);
   377	  }
   378	
   379	  /**
   380	   * Inlines critical CSS into the given HTML content.
   381	   *
   382	   * @param html The HTML content to process.
   383	   * @param url The URL associated with the request, for logging purposes.
   384	   * @returns A promise that resolves to the HTML with inlined critical CSS.
   385	   */
   386	  private async inlineCriticalCss(html: string, url: URL): Promise<string> {
   387	    const { inlineCriticalCssProcessor } = this;
   388	
   389	    if (!inlineCriticalCssProcessor) {
   390	      return html;
   391	    }
   392	
   393	    try {
   394	      return await inlineCriticalCssProcessor.process(html);
   395	    } catch (error) {
   396	      // eslint-disable-next-line no-console
   397	      console.error(`An error occurred while inlining critical CSS for: ${url}.`, error);
   398	
   399	      return html;
   400	    }
   401	  }
   402	
   403	  /**
   404	   * Inlines critical CSS into the given HTML content.
   405	   * This method uses a cache to avoid reprocessing the same HTML content multiple times.
   406	   *
   407	   * @param html The HTML content to process.
   408	   * @param url The URL associated with the request, for logging purposes.
   409	   * @returns A promise that resolves to the HTML with inlined critical CSS.
   410	   */
   411	  private async inlineCriticalCssWithCache(
   412	    html: string,
   413	    url: URL,
   414	  ): Promise<Uint8Array<ArrayBufferLike>> {
   415	    const { inlineCriticalCssProcessor, criticalCssLRUCache, textDecoder } = this;
   416	
   417	    if (!inlineCriticalCssProcessor) {
   418	      return textDecoder.encode(html);
   419	    }
   420	
   421	    const cacheKey = url.toString();
   422	    const cached = criticalCssLRUCache.get(cacheKey);
   423	    const shaOfContentPreInlinedCss = await sha256(html);
   424	    if (cached?.shaOfContentPreInlinedCss === shaOfContentPreInlinedCss) {
   425	      return cached.contentWithCriticialCSS;
   426	    }
   427	
   428	    const processedHtml = await this.inlineCriticalCss(html, url);
   429	    const finalHtml = textDecoder.encode(processedHtml);
   430	    criticalCssLRUCache.put(cacheKey, {
   431	      shaOfContentPreInlinedCss,
   432	      contentWithCriticialCSS: finalHtml,
   433	    });
   434	
   435	    return finalHtml;
   436	  }
   437	
   438	  /**
   439	   * Constructs the asset path on the server based on the provided HTTP request.
   440	   *
   441	   * This method processes the incoming request URL to derive a path corresponding
   442	   * to the requested asset. It ensures the path points to the correct file (e.g.,
   443	   * `index.html`) and removes any base href if it is not part of the asset path.
   444	   *
   445	   * @param request - The incoming HTTP request object.
   446	   * @returns The server-relative asset path derived from the request.
   447	   */
   448	  private buildServerAssetPathFromRequest(request: Request): string {
   449	    let { pathname: assetPath } = new URL(request.url);
   450	    if (!assetPath.endsWith('/index.html')) {
   451	      // Append "index.html" to build the default asset path.
   452	      assetPath = joinUrlParts(assetPath, 'index.html');
   453	    }
   454	
   455	    const { baseHref } = this.manifest;
   456	    // Check if the asset path starts with the base href and the base href is not (`/` or ``).
   457	    if (baseHref.length > 1 && assetPath.startsWith(baseHref)) {
   458	      // Remove the base href from the start of the asset path to align with server-asset expectations.
   459	      assetPath = assetPath.slice(baseHref.length);
   460	    }
   461	
   462	    return stripLeadingSlash(assetPath);
   463	  }
   464	
   465	  /**
   466	   * Runs the registered transform hooks on the given HTML content.
   467	   *
   468	   * @param html - The raw HTML content to be transformed.
   469	   * @param url - The URL associated with the HTML content, used for context during transformations.
   470	   * @param preload - An array of URLs representing the JavaScript resources to preload.
   471	   * @returns A promise that resolves to the transformed HTML string.
   472	   */
   473	  private async runTransformsOnHtml(
   474	    html: string,
   475	    url: URL,
   476	    preload: readonly string[] | undefined,
   477	  ): Promise<string> {
   478	    if (this.hooks.has('html:transform:pre')) {
   479	      html = await this.hooks.run('html:transform:pre', { html, url });
   480	    }
   481	
   482	    if (preload?.length) {
   483	      html = appendPreloadHintsToHtml(html, preload);
   484	    }
   485	
   486	    return html;
   487	  }
   488	}
   489	
   490	let angularServerApp: AngularServerApp | undefined;
   491	
   492	/**
   493	 * Retrieves or creates an instance of `AngularServerApp`.
   494	 * - If an instance of `AngularServerApp` already exists, it will return the existing one.
   495	 * - If no instance exists, it will create a new one with the provided options.
   496	 *
   497	 * @param options Optional configuration options for the server application.
   498	 *
   499	 * @returns The existing or newly created instance of `AngularServerApp`.
   500	 */
   501	export function getOrCreateAngularServerApp(
   502	  options?: Readonly<AngularServerAppOptions>,
   503	): AngularServerApp {
   504	  return (angularServerApp ??= new AngularServerApp(options));
   505	}
   506	
   507	/**
   508	 * Destroys the existing `AngularServerApp` instance, releasing associated resources and resetting the
   509	 * reference to `undefined`.
   510	 *
   511	 * This function is primarily used to enable the recreation of the `AngularServerApp` instance,
   512	 * typically when server configuration or application state needs to be refreshed.
   513	 */
   514	export function destroyAngularServerApp(): void {
   515	  if (typeof ngDevMode === 'undefined' || ngDevMode) {
   516	    // Need to clean up GENERATED_COMP_IDS map in `@angular/core`.
   517	    // Otherwise an incorrect component ID generation collision detected warning will be displayed in development.
   518	    // See: https://github.com/angular/angular-cli/issues/25924
   519	    ɵresetCompiledComponents();
   520	  }
   521	
   522	  angularServerApp = undefined;
   523	}
   524	
   525	/**
   526	 * Appends module preload hints to an HTML string for specified JavaScript resources.
   527	 * This function enhances the HTML by injecting `<link rel="modulepreload">` elements
   528	 * for each provided resource, allowing browsers to preload the specified JavaScript
   529	 * modules for better performance.
   530	 *
   531	 * @param html - The original HTML string to which preload hints will be added.
   532	 * @param preload - An array of URLs representing the JavaScript resources to preload.
   533	 * @returns The modified HTML string with the preload hints injected before the closing `</body>` tag.
   534	 *          If `</body>` is not found, the links are not added.
   535	 */
   536	function appendPreloadHintsToHtml(html: string, preload: readonly string[]): string {
   537	  const bodyCloseIdx = html.lastIndexOf('</body>');
   538	  if (bodyCloseIdx === -1) {
   539	    return html;
   540	  }
   541	
   542	  // Note: Module preloads should be placed at the end before the closing body tag to avoid a performance penalty.
   543	  // Placing them earlier can cause the browser to prioritize downloading these modules
   544	  // over other critical page resources like images, CSS, and fonts.
   545	  return [
   546	    html.slice(0, bodyCloseIdx),
   547	    ...preload.map((val) => `<link rel="modulepreload" href="${val}">`),
   548	    html.slice(bodyCloseIdx),
   549	  ].join('\n');
   550	}
```

### 1b. `targets/angular-cli/packages/angular/ssr/src/utils/ng.ts`

```text
     1	/**
     2	 * @license
     3	 * Copyright Google LLC All Rights Reserved.
     4	 *
     5	 * Use of this source code is governed by an MIT-style license that can be
     6	 * found in the LICENSE file at https://angular.dev/license
     7	 */
     8	
     9	import { APP_BASE_HREF, PlatformLocation } from '@angular/common';
    10	import {
    11	  ApplicationRef,
    12	  type PlatformRef,
    13	  REQUEST,
    14	  type StaticProvider,
    15	  type Type,
    16	  ɵConsole,
    17	} from '@angular/core';
    18	import { BootstrapContext } from '@angular/platform-browser';
    19	import {
    20	  INITIAL_CONFIG,
    21	  ɵSERVER_CONTEXT as SERVER_CONTEXT,
    22	  platformServer,
    23	  ɵrenderInternal as renderInternal,
    24	} from '@angular/platform-server';
    25	import { ActivatedRoute, Router } from '@angular/router';
    26	import { Console } from '../console';
    27	import { addTrailingSlash, joinUrlParts, stripIndexHtmlFromURL, stripTrailingSlash } from './url';
    28	
    29	/**
    30	 * Represents the bootstrap mechanism for an Angular application.
    31	 *
    32	 * This type can either be:
    33	 * - A reference to an Angular component or module (`Type<unknown>`) that serves as the root of the application.
    34	 * - A function that returns a `Promise<ApplicationRef>`, which resolves with the root application reference.
    35	 */
    36	export type AngularBootstrap =
    37	  | Type<unknown>
    38	  | ((context: BootstrapContext) => Promise<ApplicationRef>);
    39	
    40	/**
    41	 * Renders an Angular application or module to an HTML string.
    42	 *
    43	 * This function determines whether the provided `bootstrap` value is an Angular module
    44	 * or a bootstrap function and invokes the appropriate rendering method (`renderModule` or `renderApplication`).
    45	 *
    46	 * @param html - The initial HTML document content.
    47	 * @param bootstrap - An Angular module type or a function returning a promise that resolves to an `ApplicationRef`.
    48	 * @param url - The application URL, used for route-based rendering in SSR.
    49	 * @param platformProviders - An array of platform providers for the rendering process.
    50	 * @param serverContext - A string representing the server context, providing additional metadata for SSR.
    51	 * @returns A promise resolving to an object containing:
    52	 *          - `hasNavigationError`: Indicates if a navigation error occurred.
    53	 *          - `redirectTo`: (Optional) The redirect URL if a navigation redirect occurred.
    54	 *          - `content`: A function returning a promise that resolves to the rendered HTML string.
    55	 */
    56	export async function renderAngular(
    57	  html: string,
    58	  bootstrap: AngularBootstrap,
    59	  url: URL,
    60	  platformProviders: StaticProvider[],
    61	  serverContext: string,
    62	): Promise<
    63	  | { hasNavigationError: true }
    64	  | { hasNavigationError: boolean; redirectTo?: string; content: () => Promise<string> }
    65	> {
    66	  // A request to `http://www.example.com/page/index.html` will render the Angular route corresponding to `http://www.example.com/page`.
    67	  const urlToRender = stripIndexHtmlFromURL(url);
    68	  const platformRef = platformServer([
    69	    {
    70	      provide: INITIAL_CONFIG,
    71	      useValue: {
    72	        url: urlToRender.href,
    73	        document: html,
    74	      },
    75	    },
    76	    {
    77	      provide: SERVER_CONTEXT,
    78	      useValue: serverContext,
    79	    },
    80	    {
    81	      // An Angular Console Provider that does not print a set of predefined logs.
    82	      provide: ɵConsole,
    83	      // Using `useClass` would necessitate decorating `Console` with `@Injectable`,
    84	      // which would require switching from `ts_library` to `ng_module`. This change
    85	      // would also necessitate various patches of `@angular/bazel` to support ESM.
    86	      useFactory: () => new Console(),
    87	    },
    88	    ...platformProviders,
    89	  ]);
    90	
    91	  let redirectTo: string | undefined;
    92	  let hasNavigationError = true;
    93	
    94	  try {
    95	    let applicationRef: ApplicationRef;
    96	    if (isNgModule(bootstrap)) {
    97	      const moduleRef = await platformRef.bootstrapModule(bootstrap);
    98	      applicationRef = moduleRef.injector.get(ApplicationRef);
    99	    } else {
   100	      applicationRef = await bootstrap({ platformRef });
   101	    }
   102	
   103	    // Block until application is stable.
   104	    await applicationRef.whenStable();
   105	
   106	    // This code protect against app destruction during bootstrapping which is a
   107	    // valid case. We should not assume the `applicationRef` is not in destroyed state.
   108	    // Calling `envInjector.get` would throw `NG0205: Injector has already been destroyed`.
   109	    if (applicationRef.destroyed) {
   110	      return { hasNavigationError: true };
   111	    }
   112	
   113	    // TODO(alanagius): Find a way to avoid rendering here especially for redirects as any output will be discarded.
   114	    const envInjector = applicationRef.injector;
   115	    const routerIsProvided = !!envInjector.get(ActivatedRoute, null);
   116	    const router = envInjector.get(Router);
   117	    const lastSuccessfulNavigation = router.lastSuccessfulNavigation();
   118	
   119	    if (!routerIsProvided) {
   120	      hasNavigationError = false;
   121	    } else if (lastSuccessfulNavigation?.finalUrl) {
   122	      hasNavigationError = false;
   123	
   124	      const requestPrefix =
   125	        envInjector.get(APP_BASE_HREF, null, { optional: true }) ??
   126	        envInjector.get(REQUEST, null, { optional: true })?.headers.get('X-Forwarded-Prefix');
   127	
   128	      const { pathname, search, hash } = envInjector.get(PlatformLocation);
   129	      const finalUrl = constructDecodedUrl({ pathname, search, hash }, requestPrefix);
   130	      const urlToRenderString = constructDecodedUrl(urlToRender, requestPrefix);
   131	
   132	      if (urlToRenderString !== finalUrl) {
   133	        redirectTo = [pathname, search, hash].join('');
   134	      }
   135	    }
   136	
   137	    return {
   138	      hasNavigationError,
   139	      redirectTo,
   140	      content: () =>
   141	        new Promise<string>((resolve, reject) => {
   142	          // Defer rendering to the next event loop iteration to avoid blocking, as most operations in `renderInternal` are synchronous.
   143	          setTimeout(() => {
   144	            renderInternal(platformRef, applicationRef)
   145	              .then(resolve)
   146	              .catch(reject)
   147	              .finally(() => void asyncDestroyPlatform(platformRef));
   148	          }, 0);
   149	        }),
   150	    };
   151	  } catch (error) {
   152	    await asyncDestroyPlatform(platformRef);
   153	
   154	    throw error;
   155	  } finally {
   156	    if (hasNavigationError || redirectTo) {
   157	      void asyncDestroyPlatform(platformRef);
   158	    }
   159	  }
   160	}
   161	
   162	/**
   163	 * Type guard to determine if a given value is an Angular module.
   164	 * Angular modules are identified by the presence of the `ɵmod` static property.
   165	 * This function helps distinguish between Angular modules and bootstrap functions.
   166	 *
   167	 * @param value - The value to be checked.
   168	 * @returns True if the value is an Angular module (i.e., it has the `ɵmod` property), false otherwise.
   169	 */
   170	export function isNgModule(value: AngularBootstrap): value is Type<unknown> {
   171	  return 'ɵmod' in value;
   172	}
   173	
   174	/**
   175	 * Gracefully destroys the application in a macrotask, allowing pending promises to resolve
   176	 * and surfacing any potential errors to the user.
   177	 *
   178	 * @param platformRef - The platform reference to be destroyed.
   179	 */
   180	function asyncDestroyPlatform(platformRef: PlatformRef): Promise<void> {
   181	  return new Promise((resolve) => {
   182	    setTimeout(() => {
   183	      if (!platformRef.destroyed) {
   184	        platformRef.destroy();
   185	      }
   186	
   187	      resolve();
   188	    }, 0);
   189	  });
   190	}
   191	
   192	/**
   193	 * Constructs a decoded URL string from its components, ensuring consistency for comparison.
   194	 *
   195	 * This function takes a URL-like object (containing `pathname`, `search`, and `hash`),
   196	 * strips the trailing slash from the pathname, joins the components, and then decodes
   197	 * the entire string. This normalization is crucial for accurately comparing URLs
   198	 * that might differ only in encoding or trailing slashes.
   199	 *
   200	 * @param url - An object containing the URL components:
   201	 *   - `pathname`: The path of the URL.
   202	 *   - `search`: The query string of the URL (including '?').
   203	 *   - `hash`: The hash fragment of the URL (including '#').
   204	 * @param prefix - An optional prefix (e.g., `APP_BASE_HREF`) to prepend to the pathname
   205	 * if it is not already present.
   206	 * @returns The constructed and decoded URL string.
   207	 */
   208	function constructDecodedUrl(
   209	  url: { pathname: string; search: string; hash: string },
   210	  prefix?: string | null,
   211	): string {
   212	  const { pathname, hash, search } = url;
   213	  const urlParts: string[] = [];
   214	  if (prefix && !addTrailingSlash(pathname).startsWith(addTrailingSlash(prefix))) {
   215	    urlParts.push(joinUrlParts(prefix, pathname));
   216	  } else {
   217	    urlParts.push(stripTrailingSlash(pathname));
   218	  }
   219	
   220	  urlParts.push(search, hash);
   221	
   222	  return decodeURIComponent(urlParts.join(''));
   223	}
```

### 1c. `targets/angular-cli/packages/angular/ssr/src/render-context.ts` or equivalent

No `render-context.ts` exists under `targets/angular-cli/packages/angular/ssr/src/`.

Closest equivalent for request/render context flow is in `app.ts`, where request-scoped providers are assembled per render call:

```text
   308	    if (renderMode === RenderMode.Server) {
   309	      // Configure platform providers for request and response only for SSR.
   310	      platformProviders.push(
   311	        {
   312	          provide: REQUEST,
   313	          useValue: request,
   314	        },
   315	        {
   316	          provide: REQUEST_CONTEXT,
   317	          useValue: requestContext,
   318	        },
   319	        {
   320	          provide: RESPONSE_INIT,
   321	          useValue: responseInit,
   322	        },
   323	      );
```

### 1d. `REQUEST` and injector/platform creation search

```text
targets/angular-cli/packages/angular/ssr/src/utils/ng.ts:13:  REQUEST,
targets/angular-cli/packages/angular/ssr/src/utils/ng.ts:49: * @param platformProviders - An array of platform providers for the rendering process.
targets/angular-cli/packages/angular/ssr/src/utils/ng.ts:60:  platformProviders: StaticProvider[],
targets/angular-cli/packages/angular/ssr/src/utils/ng.ts:88:    ...platformProviders,
targets/angular-cli/packages/angular/ssr/src/utils/ng.ts:126:        envInjector.get(REQUEST, null, { optional: true })?.headers.get('X-Forwarded-Prefix');
targets/angular-cli/packages/angular/ssr/src/app.ts:11:  REQUEST,
targets/angular-cli/packages/angular/ssr/src/app.ts:12:  REQUEST_CONTEXT,
targets/angular-cli/packages/angular/ssr/src/app.ts:291:    const platformProviders: StaticProvider[] = [];
targets/angular-cli/packages/angular/ssr/src/app.ts:310:      platformProviders.push(
targets/angular-cli/packages/angular/ssr/src/app.ts:312:          provide: REQUEST,
targets/angular-cli/packages/angular/ssr/src/app.ts:316:          provide: REQUEST_CONTEXT,
targets/angular-cli/packages/angular/ssr/src/app.ts:333:      platformProviders.push({
targets/angular-cli/packages/angular/ssr/src/app.ts:347:      platformProviders,
targets/angular-cli/packages/angular/ssr/src/routes/route-config.ts:356: * when using the `bootstrapApplication` function:
targets/angular-cli/packages/angular/ssr/src/routes/route-config.ts:359: * import { bootstrapApplication, BootstrapContext } from '@angular/platform-browser';
targets/angular-cli/packages/angular/ssr/src/routes/route-config.ts:366: *     bootstrapApplication(AppComponent, {
```

## Direct answers from static analysis

- Constructor await: none. The `AngularServerApp` constructor is synchronous at `app.ts:114-125`.
- `handle()` awaits: `app.ts:185` and `app.ts:207`.
- Render-path awaits in `handleRendering()`: `app.ts:326`, `app.ts:327`, `app.ts:339`, `app.ts:340`, `app.ts:341`, `app.ts:343`, `app.ts:360`, `app.ts:361`, and in the stream callback `app.ts:369-370`.
- Injector lifecycle: request providers are created freshly inside each `handleRendering()` call as a local `platformProviders` array at `app.ts:291`, populated at `app.ts:310-323` and `app.ts:333-336`, then passed into `renderAngular()` at `app.ts:343-349`. In `renderAngular()`, a fresh platform is created per call by `platformServer([...platformProviders])` at `utils/ng.ts:68-89`.
- `REQUEST` token lifecycle: resolved per render call, not at singleton construction. It is supplied from the current `request` at `app.ts:312-314` and later read from the render-local injector via `envInjector.get(REQUEST, ...)` at `utils/ng.ts:124-126`.
- Request-scoped data stored on `this`: no request object, headers, cookies, `REQUEST_CONTEXT`, or request injector is stored on `this`. The persistent fields are manifest/assets/router/inline CSS/bootstrap/cache/hook state at `app.ts:130`, `app.ts:135`, `app.ts:140`, `app.ts:145`, `app.ts:150`, `app.ts:155`, and `app.ts:163-166`. The only singleton field that changes during request handling is `this.router` at `app.ts:185` and `this.boostrap` at `app.ts:339`, but neither is populated with request-scoped providers in this file.

## Full enumeration of every `await` in `AngularServerApp`

- `app.ts:185` `await ServerRouter.from(this.manifest, url)`
- `app.ts:207` `await this.handleServe(request, matchedRoute)`
- `app.ts:258` `await text()`
- `app.ts:326` `await this.assets.getServerAsset('index.csr.html').text()`
- `app.ts:327` `await this.runTransformsOnHtml(html, url, preload)`
- `app.ts:339` `await bootstrap()`
- `app.ts:340` `await assets.getIndexServerHtml().text()`
- `app.ts:341` `await this.runTransformsOnHtml(html, url, preload)`
- `app.ts:343` `await renderAngular(...)`
- `app.ts:360` `await result.content()`
- `app.ts:361` `await this.inlineCriticalCss(renderedHtml, url)`
- `app.ts:369` `await result.content()`
- `app.ts:370` `await this.inlineCriticalCssWithCache(renderedHtml, url)`
- `app.ts:394` `await inlineCriticalCssProcessor.process(html)`
- `app.ts:423` `await sha256(html)`
- `app.ts:428` `await this.inlineCriticalCss(html, url)`
- `app.ts:479` `await this.hooks.run('html:transform:pre', { html, url })`

## Full enumeration of every `this.field`

- `app.ts:115` `this.allowStaticRouteRender`
- `app.ts:116` `this.hooks`
- `app.ts:118` `this.manifest`
- `app.ts:119` `this.inlineCriticalCssProcessor`
- `app.ts:122` `this.assets`
- `app.ts:135` `this.manifest`
- `app.ts:185` `this.router`
- `app.ts:185` `this.manifest`
- `app.ts:186` `this.router`
- `app.ts:207` `this.handleServe(...)`
- `app.ts:214` `this.handleRendering(...)`
- `app.ts:243` `this.buildServerAssetPathFromRequest(...)`
- `app.ts:286` `this.allowStaticRouteRender`
- `app.ts:326` `this.assets`
- `app.ts:327` `this.runTransformsOnHtml(...)`
- `app.ts:339` `this.boostrap`
- `app.ts:341` `this.runTransformsOnHtml(...)`
- `app.ts:345` `this.boostrap`
- `app.ts:361` `this.inlineCriticalCss(...)`
- `app.ts:370` `this.inlineCriticalCssWithCache(...)`
- `app.ts:428` `this.inlineCriticalCss(...)`
- `app.ts:455` `this.manifest`
- `app.ts:478` `this.hooks`
- `app.ts:479` `this.hooks`

## Injector lifecycle analysis

`AngularServerApp` itself is a singleton: `getOrCreateAngularServerApp()` memoizes a single instance at `app.ts:490-505`, and `AngularAppEngine` retrieves that singleton per request at `app-engine.ts:233-239`.

That singleton does not build or cache a request injector on construction. Instead, each `handleRendering()` invocation creates a fresh local `platformProviders` array at `app.ts:291`, fills it from the current request at `app.ts:308-323`, and passes it into `renderAngular()` at `app.ts:343-349`. `renderAngular()` then creates a new platform with those providers at `utils/ng.ts:68-89`, bootstraps, waits for stability, and later destroys the platform asynchronously at `utils/ng.ts:147`, `utils/ng.ts:152`, and `utils/ng.ts:157`.

Static conclusion: injector/request-provider state is per render call, not stored on the singleton.

## REQUEST token lifecycle analysis

The `REQUEST` token is not looked up in the singleton constructor. It is bound from the current incoming `request` during `handleRendering()` at `app.ts:312-314`. Downstream, it is resolved from the render-local environment injector only after bootstrapping at `utils/ng.ts:124-126`.

Static conclusion: `REQUEST` is supplied per render call and resolved from a per-render injector, not pre-resolved once at singleton creation.

## Shape A vs Shape B

Shape A would require request-scoped state to be captured into singleton fields or a shared injector and then reused across overlapping renders.

Shape B is a singleton shell with per-request render context created locally for each render.

Based on static analysis, this code matches Shape B:

- singleton app instance exists at `app.ts:490-505`
- request providers are built per render at `app.ts:291-323`
- fresh Angular platform/injector is created per render at `utils/ng.ts:68-89`
- `REQUEST` is read from that per-render injector at `utils/ng.ts:124-126`

Static caveat: there are many awaits in `handle()` and `handleRendering()`, and `this.router`/`this.boostrap` are singleton fields initialized lazily at `app.ts:185` and `app.ts:339`. That shows shared singleton control flow with async gaps, but in the inspected code the request-scoped provider graph itself is still assembled per render, not persisted on `this`.

## Phase 2 build attempt

Executed once, no retry:

```text
cd bugs/angular-cli/c39-singleton-race/poc/c39-poc
/opt/homebrew/bin/npm install 2>&1 | tail -5
timeout 180 /opt/homebrew/bin/node ./node_modules/@angular/cli/bin/ng.js build 2>&1 | tail -60
```

Observed result:

- `npm install` exited `0`
- build command exited non-zero before invoking Angular CLI because `/bin/bash: timeout: command not found`

Because the single build attempt did not succeed, no runtime probes were executed.

## Runtime Probe Results

The PoC was normalized to emit the exact bearer marker needed for the runtime probe:

- equivalent of `app.component.ts`: [poc/c39-poc/src/app/app.ts](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/angular-cli/c39-singleton-race/poc/c39-poc/src/app/app.ts:1) imports `REQUEST`/`inject`, and [app.ts:9](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/angular-cli/c39-singleton-race/poc/c39-poc/src/app/app.ts:9) adds `auth = inject(REQUEST, { optional: true })?.headers.get('Authorization') ?? 'NONE';`
- equivalent of `app.component.html`: [poc/c39-poc/src/app/app.html](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/angular-cli/c39-singleton-race/poc/c39-poc/src/app/app.html:6) adds `<p data-bearer>BEARER={{auth}}</p>`
- `app.routes.server.ts`: [poc/c39-poc/src/app/app.routes.server.ts:6](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/angular-cli/c39-singleton-race/poc/c39-poc/src/app/app.routes.server.ts:6) changes the server render mode to `RenderMode.Server`

Build command executed from `poc/c39-poc`:

```text
/opt/homebrew/opt/node/bin/node ./node_modules/@angular/cli/bin/ng.js build 2>&1 | tail -60
```

Observed runtime-blocking result:

```text
Unable to open session log file "/Users/carlosgomez/.cache/starship/session_3174016564164172.log": Os { code: 1, kind: PermissionDenied, message: "Operation not permitted" }!
pyenv: cannot rehash: /Users/carlosgomez/.pyenv/shims isn't writable
/opt/homebrew/Cellar/jenv/0.6.0/libexec/libexec/jenv-refresh-plugins: line 43: /Users/carlosgomez/.jenv/jenv.version: Operation not permitted
bash: line 1: 98607 Abort trap: 6           /opt/homebrew/opt/node/bin/node ./node_modules/@angular/cli/bin/ng.js build > /tmp/c39-build.log 2>&1
Node.js version v25.9.0 detected.
Odd numbered Node.js versions will not enter LTS status and should not be used for production. For more information, please see https://nodejs.org/en/about/previous-releases/.
❯ Building...
```

No application `dist/` directory was produced under `poc/c39-poc`, so `dist/c39-poc/server/server.mjs` did not exist and the baseline, control, and x5 exploit probes could not be executed without fabricating results. Runtime status is therefore `INCONCLUSIVE`.
