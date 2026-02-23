import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'CollabBoard API',
      version: '1.0.0',
      description: 'Real-time collaborative whiteboard backend API',
    },
    servers: [
      {
        url:
          process.env.NODE_ENV === 'production'
            ? 'https://g4-collabboard-production.up.railway.app'
            : 'http://localhost:3001',
        description:
          process.env.NODE_ENV === 'production'
            ? 'Production'
            : 'Local development',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Auth0 JWT token',
        },
        metricsToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Metrics-Token',
          description: 'Static token for metrics endpoint access',
        },
      },
      schemas: {
        Board: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            ownerId: { type: 'string' },
            thumbnail: { type: 'string', nullable: true, description: 'Base64-encoded thumbnail image' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        BoardVersion: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            boardId: { type: 'string', format: 'uuid' },
            version: { type: 'integer' },
            snapshot: { type: 'object', description: 'Full canvas object snapshot' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        TeleportFlag: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            boardId: { type: 'string', format: 'uuid' },
            label: { type: 'string' },
            color: { type: 'string', description: 'Hex color string, e.g. #FF5733' },
            x: { type: 'number', description: 'Canvas X coordinate' },
            y: { type: 'number', description: 'Canvas Y coordinate' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        UserProfile: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string', nullable: true },
            picture: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        AIStatus: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            budgetUsedCents: { type: 'number' },
            budgetTotalCents: { type: 'number' },
            rateLimitRemaining: { type: 'integer' },
          },
        },
        AICommandRequest: {
          type: 'object',
          required: ['command', 'boardId'],
          properties: {
            command: { type: 'string', description: 'Natural language instruction for the AI agent' },
            boardId: { type: 'string', format: 'uuid' },
          },
        },
        AICommandResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            operationsApplied: { type: 'integer' },
            message: { type: 'string' },
          },
        },
        AIError: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            boardId: { type: 'string', format: 'uuid', nullable: true },
            userId: { type: 'string', nullable: true },
            command: { type: 'string' },
            errorMessage: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
            statusCode: { type: 'integer' },
          },
        },
        PaginatedAIErrors: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: { '$ref': '#/components/schemas/AIError' },
            },
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      // ─── System ────────────────────────────────────────────────────────────
      '/health': {
        get: {
          summary: 'Health check',
          description: 'Returns service health and database connectivity status.',
          tags: ['System'],
          security: [],
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'healthy' },
                      database: { type: 'string', example: 'connected' },
                    },
                  },
                },
              },
            },
            '503': {
              description: 'Service is unhealthy — database unreachable',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'unhealthy' },
                      database: { type: 'string', example: 'disconnected' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/metrics': {
        get: {
          summary: 'Application metrics',
          description:
            'Returns runtime metrics including WebSocket event counts, active connections, Redis operation counts, DB query counts, latency percentiles, and active edit locks. When METRICS_TOKEN is set in the environment, the X-Metrics-Token header is required.',
          tags: ['System'],
          security: [{ metricsToken: [] }],
          responses: {
            '200': {
              description: 'Metrics snapshot',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    description: 'Metrics snapshot — structure varies by runtime state',
                  },
                  example: {
                    connections: { active: 3, total: 12 },
                    events: { 'object:create': 5, 'object:update': 42 },
                    editLocks: { active: 1, locks: [] },
                  },
                },
              },
            },
            '403': {
              description: 'Forbidden — invalid or missing metrics token',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/Error' },
                },
              },
            },
            '500': {
              description: 'Internal error retrieving metrics',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },

      // ─── Auth / User ────────────────────────────────────────────────────────
      '/auth/me': {
        get: {
          summary: 'Get current user profile',
          description: 'Returns the authenticated user\'s profile, creating it in the database on first login.',
          tags: ['Auth'],
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'User profile',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/UserProfile' },
                },
              },
            },
            '401': {
              description: 'Unauthorized — missing or invalid JWT',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        patch: {
          summary: 'Update current user profile',
          description: 'Updates the authenticated user\'s display name or picture URL.',
          tags: ['Auth'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', nullable: true },
                    picture: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated user profile',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/UserProfile' },
                },
              },
            },
            '400': {
              description: 'Validation error',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/Error' },
                },
              },
            },
            '401': {
              description: 'Unauthorized',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },

      // ─── Boards ─────────────────────────────────────────────────────────────
      '/boards': {
        get: {
          summary: 'List boards',
          description: 'Returns all boards owned by or shared with the authenticated user.',
          tags: ['Boards'],
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Array of boards',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { '$ref': '#/components/schemas/Board' },
                  },
                },
              },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
        post: {
          summary: 'Create a board',
          description: 'Creates a new board owned by the authenticated user.',
          tags: ['Boards'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title'],
                  properties: {
                    title: { type: 'string', minLength: 1, maxLength: 100 },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Board created',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/Board' },
                },
              },
            },
            '400': {
              description: 'Validation error',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/boards/{id}': {
        get: {
          summary: 'Get a board',
          description: 'Returns a single board by ID. The user must own or have access to the board.',
          tags: ['Boards'],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Board ID',
            },
          ],
          responses: {
            '200': {
              description: 'Board data',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/Board' },
                },
              },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '404': {
              description: 'Board not found',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
        patch: {
          summary: 'Rename a board',
          description: 'Updates the title of an existing board.',
          tags: ['Boards'],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Board ID',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title'],
                  properties: {
                    title: { type: 'string', minLength: 1, maxLength: 100 },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated board',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/Board' },
                },
              },
            },
            '400': {
              description: 'Validation error',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '403': {
              description: 'Forbidden — user does not own this board',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '404': {
              description: 'Board not found',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
        delete: {
          summary: 'Delete a board',
          description: 'Permanently deletes a board and all its objects. Only the owner can delete.',
          tags: ['Boards'],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Board ID',
            },
          ],
          responses: {
            '204': { description: 'Board deleted' },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '403': {
              description: 'Forbidden — user does not own this board',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '404': {
              description: 'Board not found',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/boards/{id}/link': {
        delete: {
          summary: 'Unlink (leave) a shared board',
          description: 'Removes the authenticated user from a shared board without deleting the board itself.',
          tags: ['Boards'],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Board ID',
            },
          ],
          responses: {
            '204': { description: 'Board unlinked' },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '404': {
              description: 'Board or membership not found',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/boards/{id}/thumbnail': {
        put: {
          summary: 'Save board thumbnail',
          description: 'Saves or replaces the board\'s thumbnail image (base64-encoded PNG).',
          tags: ['Boards'],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Board ID',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['thumbnail'],
                  properties: {
                    thumbnail: {
                      type: 'string',
                      description: 'Base64-encoded PNG image string',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Thumbnail saved',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/Board' },
                },
              },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '403': {
              description: 'Forbidden',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '404': {
              description: 'Board not found',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
      },

      // ─── Versions ───────────────────────────────────────────────────────────
      '/boards/{id}/versions': {
        get: {
          summary: 'List board versions',
          description: 'Returns the version history snapshots for a board. Snapshots are created automatically every 5th auto-save.',
          tags: ['Versions'],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Board ID',
            },
          ],
          responses: {
            '200': {
              description: 'Array of board versions (newest first)',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { '$ref': '#/components/schemas/BoardVersion' },
                  },
                },
              },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '404': {
              description: 'Board not found',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
      },

      // ─── Teleport Flags ─────────────────────────────────────────────────────
      '/boards/{id}/flags': {
        get: {
          summary: 'List teleport flags',
          description: 'Returns all teleport flags for a board, sorted by creation date.',
          tags: ['Teleport Flags'],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Board ID',
            },
          ],
          responses: {
            '200': {
              description: 'Array of teleport flags',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { '$ref': '#/components/schemas/TeleportFlag' },
                  },
                },
              },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '404': {
              description: 'Board not found',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
        post: {
          summary: 'Create a teleport flag',
          description: 'Creates a new teleport flag at the specified canvas coordinates.',
          tags: ['Teleport Flags'],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Board ID',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['label', 'x', 'y'],
                  properties: {
                    label: { type: 'string', minLength: 1, maxLength: 50 },
                    color: { type: 'string', description: 'Hex color (e.g. #FF5733)', default: '#4f46e5' },
                    x: { type: 'number' },
                    y: { type: 'number' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Flag created',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/TeleportFlag' },
                },
              },
            },
            '400': {
              description: 'Validation error',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '404': {
              description: 'Board not found',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/boards/{id}/flags/{flagId}': {
        patch: {
          summary: 'Update a teleport flag',
          description: 'Updates the label, color, or canvas coordinates of an existing flag.',
          tags: ['Teleport Flags'],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Board ID',
            },
            {
              name: 'flagId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Flag ID',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', minLength: 1, maxLength: 50 },
                    color: { type: 'string' },
                    x: { type: 'number' },
                    y: { type: 'number' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated flag',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/TeleportFlag' },
                },
              },
            },
            '400': {
              description: 'Validation error',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '404': {
              description: 'Board or flag not found',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
        delete: {
          summary: 'Delete a teleport flag',
          description: 'Permanently removes a teleport flag from the board.',
          tags: ['Teleport Flags'],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Board ID',
            },
            {
              name: 'flagId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: 'Flag ID',
            },
          ],
          responses: {
            '204': { description: 'Flag deleted' },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '404': {
              description: 'Board or flag not found',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
      },

      // ─── AI ─────────────────────────────────────────────────────────────────
      '/ai/execute': {
        post: {
          summary: 'Execute an AI command',
          description:
            'Sends a natural language command to the AI agent, which interprets it and applies canvas operations (create, move, delete objects, etc.) on the specified board. Subject to per-user AI budget limits.',
          tags: ['AI'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { '$ref': '#/components/schemas/AICommandRequest' },
                example: {
                  command: 'Add a yellow sticky note saying "Hello world" in the center',
                  boardId: '550e8400-e29b-41d4-a716-446655440000',
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Command executed successfully',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/AICommandResponse' },
                },
              },
            },
            '400': {
              description: 'Validation error or bad command',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '402': {
              description: 'AI budget exhausted',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '429': {
              description: 'Rate limit exceeded',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/ai/status': {
        get: {
          summary: 'Get AI budget and rate limit status',
          description: 'Returns the current user\'s AI usage budget (spent vs. total) and rate limit info.',
          tags: ['AI'],
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'AI status',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/AIStatus' },
                },
              },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
      },

      // ─── Audit ──────────────────────────────────────────────────────────────
      '/audit/ai-errors': {
        get: {
          summary: 'List AI error audit log',
          description:
            'Returns a paginated list of AI command errors for monitoring and debugging. Supports `limit` (max 200, default 50) and `offset` query parameters.',
          tags: ['Audit'],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
              description: 'Number of records to return',
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', minimum: 0, default: 0 },
              description: 'Number of records to skip',
            },
          ],
          responses: {
            '200': {
              description: 'Paginated AI error records',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/PaginatedAIErrors' },
                },
              },
            },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
            '500': {
              description: 'Internal error fetching audit log',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
      },

      // ─── API Docs ────────────────────────────────────────────────────────────
      '/api-docs/swagger.json': {
        get: {
          summary: 'OpenAPI spec (JSON)',
          description:
            'Returns the raw OpenAPI 3.0 specification as JSON. Protected by the same X-Metrics-Token guard used by /metrics when METRICS_TOKEN is set.',
          tags: ['System'],
          security: [{ metricsToken: [] }],
          responses: {
            '200': {
              description: 'OpenAPI spec',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '403': {
              description: 'Forbidden',
              content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } },
            },
          },
        },
      },
    },
  },
  apis: [], // Paths defined inline above
};

export const swaggerSpec = swaggerJsdoc(options);
