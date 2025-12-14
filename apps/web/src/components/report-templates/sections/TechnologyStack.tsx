import { 
  Code, 
  Database, 
  Cloud, 
  Lock,
  Zap,
  Layers,
  Server,
  Shield,
  CheckCircle,
  TrendingUp
} from 'lucide-react';

interface TechnologyStackProps {
  data: any;
  darkMode: boolean;
}

export function TechnologyStack({ data, darkMode }: TechnologyStackProps) {
  const techStack = {
    frontend: {
      name: 'Frontend',
      icon: Code,
      color: '#3b82f6',
      technologies: [
        { name: 'React 18', version: '18.2.0', purpose: 'UI Framework', status: 'Production' },
        { name: 'TypeScript', version: '5.0', purpose: 'Type Safety', status: 'Production' },
        { name: 'Next.js', version: '14.0', purpose: 'SSR & Routing', status: 'Production' },
        { name: 'Tailwind CSS', version: '3.4', purpose: 'Styling', status: 'Production' }
      ]
    },
    backend: {
      name: 'Backend',
      icon: Server,
      color: '#10b981',
      technologies: [
        { name: 'Node.js', version: '20.x', purpose: 'Runtime', status: 'Production' },
        { name: 'Express', version: '4.18', purpose: 'API Framework', status: 'Production' },
        { name: 'GraphQL', version: '16.x', purpose: 'API Layer', status: 'Production' },
        { name: 'Python', version: '3.11', purpose: 'ML Services', status: 'Production' }
      ]
    },
    database: {
      name: 'Database & Storage',
      icon: Database,
      color: '#f59e0b',
      technologies: [
        { name: 'PostgreSQL', version: '15.x', purpose: 'Primary Database', status: 'Production' },
        { name: 'Redis', version: '7.x', purpose: 'Caching', status: 'Production' },
        { name: 'MongoDB', version: '7.0', purpose: 'Document Store', status: 'Production' },
        { name: 'S3', version: 'AWS', purpose: 'Object Storage', status: 'Production' }
      ]
    },
    infrastructure: {
      name: 'Infrastructure',
      icon: Cloud,
      color: '#8b5cf6',
      technologies: [
        { name: 'AWS', version: 'Cloud', purpose: 'Cloud Provider', status: 'Production' },
        { name: 'Docker', version: '24.x', purpose: 'Containerization', status: 'Production' },
        { name: 'Kubernetes', version: '1.28', purpose: 'Orchestration', status: 'Production' },
        { name: 'Terraform', version: '1.6', purpose: 'IaC', status: 'Production' }
      ]
    },
    security: {
      name: 'Security',
      icon: Shield,
      color: '#ef4444',
      technologies: [
        { name: 'Auth0', version: 'SaaS', purpose: 'Authentication', status: 'Production' },
        { name: 'Vault', version: '1.15', purpose: 'Secrets Management', status: 'Production' },
        { name: 'WAF', version: 'AWS', purpose: 'Web Firewall', status: 'Production' },
        { name: 'SSL/TLS', version: '1.3', purpose: 'Encryption', status: 'Production' }
      ]
    },
    ai: {
      name: 'AI/ML',
      icon: Zap,
      color: '#ec4899',
      technologies: [
        { name: 'OpenAI GPT-4', version: 'API', purpose: 'LLM', status: 'Production' },
        { name: 'TensorFlow', version: '2.14', purpose: 'ML Framework', status: 'Production' },
        { name: 'PyTorch', version: '2.1', purpose: 'Deep Learning', status: 'Beta' },
        { name: 'Pinecone', version: 'SaaS', purpose: 'Vector DB', status: 'Production' }
      ]
    }
  };

  const architectureHighlights = [
    {
      title: 'Microservices Architecture',
      description: 'Modular, scalable design with independent services',
      icon: Layers,
      benefits: ['Easy to scale', 'Independent deployment', 'Technology flexibility']
    },
    {
      title: 'Cloud-Native',
      description: 'Built for cloud with auto-scaling and high availability',
      icon: Cloud,
      benefits: ['99.9% uptime', 'Auto-scaling', 'Global distribution']
    },
    {
      title: 'Security-First',
      description: 'Enterprise-grade security with SOC 2 compliance',
      icon: Lock,
      benefits: ['Data encryption', 'Zero-trust architecture', 'Regular audits']
    },
    {
      title: 'Performance Optimized',
      description: 'Sub-100ms response times with global CDN',
      icon: Zap,
      benefits: ['Edge caching', 'Database optimization', 'Async processing']
    }
  ];

  const scalabilityMetrics = [
    { label: 'Current Capacity', value: '10K', unit: 'req/sec' },
    { label: 'Max Tested Capacity', value: '100K', unit: 'req/sec' },
    { label: 'Database Size', value: '500GB', unit: 'current' },
    { label: 'Avg Response Time', value: '<50ms', unit: 'p95' }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center">
            <Code className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl" style={{ color: darkMode ? '#fff' : '#000' }}>
              Technology Stack
            </h2>
            <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              Modern, scalable, and production-ready infrastructure
            </p>
          </div>
        </div>
      </div>

      {/* Scalability Metrics */}
      <div className="grid grid-cols-4 gap-4">
        {scalabilityMetrics.map((metric, index) => (
          <div
            key={index}
            className="p-4 rounded-xl text-center"
            style={{ 
              backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
              border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}
          >
            <div className="text-2xl mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
              {metric.value}
            </div>
            <div className="text-xs mb-1" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              {metric.label}
            </div>
            <div className="text-xs text-emerald-500">
              {metric.unit}
            </div>
          </div>
        ))}
      </div>

      {/* Tech Stack Categories */}
      <div className="space-y-4">
        {Object.values(techStack).map((category, index) => {
          const Icon = category.icon;
          return (
            <div
              key={index}
              className="p-5 rounded-xl"
              style={{ 
                backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: category.color + '20' }}
                >
                  <Icon className="w-5 h-5" style={{ color: category.color }} />
                </div>
                <h3 className="text-lg" style={{ color: darkMode ? '#fff' : '#000' }}>
                  {category.name}
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {category.technologies.map((tech, techIndex) => (
                  <div
                    key={techIndex}
                    className="p-3 rounded-lg"
                    style={{ 
                      backgroundColor: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.5)',
                      border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                    }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                          {tech.name}
                        </div>
                        <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>
                          v{tech.version}
                        </div>
                      </div>
                      <div 
                        className="px-2 py-0.5 rounded text-xs"
                        style={{ 
                          backgroundColor: tech.status === 'Production' ? '#10b98120' : '#f59e0b20',
                          color: tech.status === 'Production' ? '#10b981' : '#f59e0b'
                        }}
                      >
                        {tech.status}
                      </div>
                    </div>
                    <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                      {tech.purpose}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Architecture Highlights */}
      <div>
        <h3 className="text-lg mb-4" style={{ color: darkMode ? '#fff' : '#000' }}>
          Architecture Highlights
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {architectureHighlights.map((highlight, index) => {
            const Icon = highlight.icon;
            return (
              <div
                key={index}
                className="p-5 rounded-xl"
                style={{ 
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                  border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
                }}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="text-sm mb-1" style={{ color: darkMode ? '#fff' : '#000' }}>
                      {highlight.title}
                    </h4>
                    <p className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
                      {highlight.description}
                    </p>
                  </div>
                </div>
                <div className="space-y-1">
                  {highlight.benefits.map((benefit, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                      <span className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
                        {benefit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Technical Debt & Roadmap */}
      <div 
        className="p-6 rounded-xl"
        style={{ 
          backgroundColor: darkMode ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.05)',
          border: '1px solid rgba(99,102,241,0.2)'
        }}
      >
        <h3 className="text-lg mb-3 flex items-center gap-2" style={{ color: darkMode ? '#fff' : '#000' }}>
          <TrendingUp className="w-5 h-5 text-[#6366f1]" />
          Technology Roadmap
        </h3>
        <div className="space-y-3">
          <div>
            <div className="text-sm mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
              Q1 2025: Enhanced AI Capabilities
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              • Implement GPT-4 Turbo for faster processing<br />
              • Add custom fine-tuned models for domain expertise<br />
              • Vector search optimization
            </div>
          </div>
          <div>
            <div className="text-sm mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
              Q2 2025: Global Scale
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              • Multi-region deployment (US, EU, APAC)<br />
              • Edge computing for &lt;10ms latency<br />
              • Database sharding for horizontal scaling
            </div>
          </div>
          <div>
            <div className="text-sm mb-2" style={{ color: darkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)' }}>
              Q3 2025: Enterprise Features
            </div>
            <div className="text-xs" style={{ color: darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)' }}>
              • SSO and SAML integration<br />
              • Advanced audit logging<br />
              • Custom deployment options (on-prem, hybrid)
            </div>
          </div>
        </div>
      </div>

      {/* Technical Debt Statement */}
      <div 
        className="p-4 rounded-xl"
        style={{ 
          backgroundColor: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
          border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
        }}
      >
        <p className="text-sm" style={{ color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' }}>
          <strong>Technical Debt Management:</strong> We maintain a technical debt ratio of {'<'}15% and allocate 20% of each sprint to refactoring and optimization. All production code has 80%+ test coverage and undergoes peer review.
        </p>
      </div>
    </div>
  );
}